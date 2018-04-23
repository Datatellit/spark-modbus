const modbus = require('modbus-stream')
const uuid = require('uuid/v1')
const logger = require('./logger')
const SparkModbus = require('../model/SparkModbus')
const path = require('path')
const moment = require('moment')
const fs = require('fs')
const utilities = require('./util')
const EventPublisher = require('./eventPublisher')
const EventEmitter = require('events').EventEmitter;

class ModbusServer extends EventEmitter {
    /*
    * port 监听的端口
    * options {coreKeysDir:key文件路径,dev:bool是否日志,rabbitMq}
     */
    constructor (port, options) {
        super()
        this.port = port || 8052
        this.options = Object.assign({}, {
            dev: null,
            mqUrl: null,
            coreKeysDir: path.join(__dirname, '../data'),
            exchange: 'dtit.device.data'
        }, options)
        this._cores = {}
        this._allCores = {}
        this._allCoresByID = {}
        this._attribsByID = {}
        this.loadCoreData()
        if (!global.event)
            global.event = new EventPublisher(this.options.mqUrl, this.options.exchange);
    }

    getCoreAttributes (coreID) {
        //assert this exists and is set properly when asked.
        this._attribsByID[coreID] = this._attribsByID[coreID] || {};
        return this._attribsByID[coreID];
    }

    getCoreByCoreID (coreID) {
        return this._allCoresByID[coreID] || null
    }

    setCoreAttribute (coreID, name, value) {
        this._attribsByID[coreID] = this._attribsByID[coreID] || {};
        this._attribsByID[coreID][name] = value;
        this.saveCoreData(coreID, this._attribsByID[coreID]);
        return true;
    }

    start () {
        modbus.tcp.server({debug: this.options.dev}, conn => {
            // 连接成功
            let connId = uuid()
            logger.log('Modbus Connection from: ' + conn.transport.stream.remoteAddress + ', connId: ' + connId);
            let core = new SparkModbus(conn)
            core._connection_key = connId;
            this._cores[connId] = core;
            let coreID = null
            // 调用连接成功事件
            core.onReady()
            // 获取coreID
            core.getCoreID().then(id => {
                // 心跳开始
                logger.log('Modbus Core online!');
                core.state.connected = true
                // 获取CoreID
                core.socket.coreID = core.coreID = coreID = id
                this._allCoresByID[coreID] = core;
                this._attribsByID[coreID] = this._attribsByID[coreID] || {
                    coreID: coreID,
                    connected: true
                };
                this._allCores[coreID] = true;
                this.setCoreAttribute(coreID, 'ip', core.getRemoteIPAddress());
                this.setCoreAttribute(coreID, 'last_heard', core.connStartTime);
                this.setCoreAttribute(coreID, 'cellular', core.cellular);
                this.setCoreAttribute(coreID, 'product_id', core.productID);
                this.setCoreAttribute(coreID, 'platform_id', core.platformID);
                core.getFirmwareVersion().then(version => {
                    this.setCoreAttribute(coreID, 'firmware_version', version);
                    logger.log('Modbus Attributes: ' + JSON.stringify(this._attribsByID[coreID]));
                }).catch(err => {
                    this.getCoreAttributes(coreID, 'firmware_version', 0)
                })
                // 自动校时
                core.setOnTime().then(d => {
                    logger.log('Modbus auto time')
                }).catch(err => {
                    logger.log('Modbus auto time error', err)
                })
                global.event.publish(false, 'spark/status', null, 'online', 30, moment(new Date()).toISOString(), coreID);
                this.emit('online', coreID)
            })
            conn.transport.on('incoming-data', d => {
                // 判断如果是心跳消息，则处理
                if (d.length === 37) {
                    const buffer = Buffer.allocUnsafeSlow(d.readInt8(8))
                    d.copy(buffer, 0, 9)
                    // 解析心跳消息
                    // 更新最后心跳时间
                    this.setCoreAttribute(core.coreID, 'last_heard', new Date())
                    // 设置心跳信息到对象
                    core.heartbeat(buffer)
                }
            })
            core.on('disconnect', d => {
                this.setCoreAttribute(coreID, 'last_heard', new Date())
                // 如果设备在3s内可以上线，不发送离线通知，避免网络不稳定导致的频繁上下线告警
                logger.log('modbus wait 3 second disconnect coreID:%s', coreID)
                setTimeout(() => {
                    // 清除资源，此处在做一次判断，防止偶然性发生
                    if (!this._allCoresByID[coreID].state.connected) {
                        this._cores[connId].removeAllListeners()
                        try {
                            logger.log('dispose connection')
                            conn.close()
                            this._cores[connId].transport && this._cores[connId].transport.stream.end()
                        } catch (e) {
                            logger.log(e)
                        }
                        delete this._cores[connId];
                        delete this._allCoresByID[coreID]
                    }
                    if (!this._allCoresByID[coreID]) {
                        logger.log('modbus disconnected coreID:%s', coreID)
                        // 正式通知下线
                        global.event.publish(false, 'spark/status', null, 'offline', 30, moment(new Date()).toISOString(), coreID);
                        this.emit('offline', coreID)
                    }
                }, 3000)
            })
        }).listen(this.port, () => {
            logger.log('modbus server on %s', this.port)
        });
    }

    saveCoreData (coreid, attribs) {
        try {
            attribs = attribs || {};
            let jsonStr = JSON.stringify(attribs, null, 2);
            if (!jsonStr) {
                return false;
            }
            let fullPath = path.join(this.options.coreKeysDir, coreid + '.json');
            fs.writeFileSync(fullPath, jsonStr);
            return true;
        }
        catch (ex) {
            logger.error('Error saving core data ', ex);
        }
        return false;
    }

    loadCoreData () {
        let attribsByID = {};
        if (!fs.existsSync(this.options.coreKeysDir)) {
            console.log('Modbus core keys directory didn\'t exist, creating... ' + this.options.coreKeysDir);
            fs.mkdirSync(this.options.coreKeysDir);
        }

        let files = fs.readdirSync(this.options.coreKeysDir);
        for (let i = 0; i < files.length; i++) {
            let filename = files[i],
                fullPath = path.join(this.options.coreKeysDir, filename),
                ext = utilities.getFilenameExt(filename),
                id = utilities.filenameNoExt(utilities.filenameNoExt(filename));

            if (ext == '.json' && id.length === 16) {
                try {
                    let contents = fs.readFileSync(fullPath);
                    let core = JSON.parse(contents);
                    // 文件读取的默认为未上线
                    core.connected = false
                    core.coreID = core.coreID || id;
                    attribsByID[core.coreID] = core;
                    this._allCores[core.coreID] = true;
                    logger.log('Modbus found ' + core.coreID);
                }
                catch (ex) {
                    logger.error('Error loading core file ' + filename);
                }
            }
        }
        this._attribsByID = attribsByID;
    }

    /**
     * return all the cores we know exist
     * @returns {null}
     */
    getAllCoreIDs () {
        return this._allCores;
    }
}

module.exports = ModbusServer;