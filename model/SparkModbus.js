/*
*   Copyright (c) 2015 Particle Industries, Inc.  All rights reserved.
*
*   This program is free software; you can redistribute it and/or
*   modify it under the terms of the GNU Lesser General Public
*   License as published by the Free Software Foundation, either
*   version 3 of the License, or (at your option) any later version.
*
*   This program is distributed in the hope that it will be useful,
*   but WITHOUT ANY WARRANTY; without even the implied warranty of
*   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
*   Lesser General Public License for more details.
*
*   You should have received a copy of the GNU Lesser General Public
*   License along with this program; if not, see <http://www.gnu.org/licenses/>.
*/


const EventEmitter = require('events').EventEmitter;
const moment = require('moment');
const fs = require('fs');
const logger = require('../lib/logger.js');
const errorCode = require('../lib/errorCode')

/**
 * Implementation of the Spark Modbus messaging protocol
 * @SparkModbus
 * events
 * heartbeat->心跳事件
 * disconnect->离线事件
 */
class SparkModbus extends EventEmitter {
    constructor(socket) {
        super()
        this.connStartTime = new Date();
        this.cellular = false
        this.productID = 0
        this.platformID = 0
        this.state = {}
        this.socket = socket
        this.setSocket()
    }

    setSocket() {
        this.socket.transport.stream.setNoDelay(true)
        this.socket.transport.stream.on('close', () => {
            // 进行关闭处理，并处理状态
            this.disconnect()
        })
        this.socket.transport.stream.on('timeout', () => {
            logger.log('modbus timeout')
            // 关闭
            this.disconnect('TIMEOUT')
        })
        this.socket.transport.stream.on('disconnect', () => {
            logger.log('modbus disconnect:' + this.coreID)
            this.disconnect()
        })
        this.socket.transport.stream.on('error', (err) => {
            logger.log('modbus error', err)
            this.disconnect()
        })
    }

    /*
  * 连接成功事件
   */
    onReady() {
        // 设置超时时间，根据设备心跳时间+10s
        this.queue.go(this._getSingle, [21, 1, this.socket]).then(d => {
            let interval = d[0].readUInt16BE()
            this.socket.transport.stream.setKeepAlive(true, (interval + 10) * 1000)
            this.socket.transport.stream.setTimeout((interval + 10) * 1000);
        })
    }

    getRemoteIPAddress() {
        return (this.socket.transport.stream.remoteAddress && this.socket.transport.stream.remoteAddress) ? this.socket.transport.stream.remoteAddress.toString() : "unknown";
    }

    heartbeat(data) {
        let bit = 0
        let tmp = 0
        for (let i = 0; i < data.length; i += 2) {
            switch (bit) {
                case 0:
                    this.state.errorCode = data.readUInt16BE(i);
                    // 检查状态并发送告警事件
                    this._checkAlarm(this.state.errorCode)
                    break;
                case 1:
                    // 运行模式：0 自动 1 制冷 2 除湿 3 送风 4 制热
                    this.state.mode = data.readUInt16BE(i) == 1 ? 0 : data.readUInt16BE(i) == 4 ? 1 : data.readUInt16BE(i);
                    break;
                case 2:
                    // 当前空调运行温度：℃
                    this.state.tt = data.readUInt16BE(i);
                    break;
                case 3:
                    // 当前风速： 0 自动 1 低档 2 中档 3 高档
                    this.state.air = data.readUInt16BE(i);
                    break;
                case 4:
                    // 0 关闭状态 1 运行状态
                    this.state.state = data.readUInt16BE(i);
                    break;
                case 5:
                    // 云感遥控器的剩余电量，单位%
                    this.state.battery = data.readUInt16BE(i);
                    break;
                case 6:
                    // 单位：安培
                    this.state.ammeter = data.readUInt16BE(i);
                    break;
                case 7:
                    tmp = data.readUInt16BE(i)
                    break;
                case 8:
                    this.state.todayPower = (data.readUInt16BE(i) * 65536 + tmp) / 100
                    break;
                case 9:
                    tmp = data.readUInt16BE(i)
                    break;
                case 10:
                    this.state.totalPower = (data.readUInt16BE(i) * 65536 + tmp) / 100
                    break;
            }
            bit++
        }
        // 更新连接状态及last_heart
        this.state.connected = true
        this.state.lastHeart = new Date()
        // 获取当前温湿度信息
        this.getSensor().then(sensor => {
            Object.assign(this.state, sensor)
            // 通知上层应用，状态更新消息
            if (global.event) {
                global.event.publish(false, 'xlc-modbus-heartbeat', null, this.state, 30, moment(new Date()).toISOString(), this.coreID);
            }
            this.emit('heartbeat', this.state)
        })
    }

    getSensor() {
        const that = this
        return new Promise((resovle, reject) => {
            that.queue.go(that._getSingle, [561, 2, that.socket]).then(sensor => {
                let DHTh = 0
                let DHTt = 0
                sensor.forEach((k, i) => {
                    if (i === 0) {
                        DHTt = k.readUInt16BE() / 100
                    } else {
                        DHTh = k.readUInt16BE() / 100
                    }
                })
                resovle({sensor: {DHTt: DHTt, DHTh: DHTh}})
            }).catch(err => {
                logger.log('Modbus get sensor error', err)
            })
        })
    }

    /*
    * 对设备进行校时操作，此操作应确保服务器的时间准确
     */
    setOnTime() {
        let ts = parseInt(new Date().getTime().toString().substr(0, 10))
        let high = ts >> 16
        let low = ts & 65535
        let time = Buffer.from(['0x' + ((low & 0xff00) >> 8).toString(16), '0x' + (low & 0xff).toString(16)])
        let time1 = Buffer.from(['0x' + ((high & 0xff00) >> 8).toString(16), '0x' + (high & 0xff).toString(16)])
        return this.queue.go(this._setMultiple, [91, [time, time1], this.socket])
    }

    /*
    * 设备的客户端唯一标识
    * 存储用户自定义数据，限制最大位64位1-9a-f的任意组合，最大为fff...(64)，但是本系统默认为24位
     */
    setCoreID(data) {
        const that = this
        return new Promise(function (resolve, reject) {
            if (data.length != 24) {
                reject('Modbus coreID length must 24')
            }
            if (/^[0-9a-fA-F]+$/.test(data)) {
                let write = []
                let arr = data.split('')
                for (let i = 0; i < arr.length; i += 4) {
                    if (i % 4 === 0) {
                        write.push(Buffer.from(['0x' + arr[i] + arr[i + 1], '0x' + arr[i + 2] + arr[i + 3]]))
                    }
                }
                return that.queue.go(that._setMultiple, [173, write, that.socket])
            } else {
                reject('Modbs coreId rule [0-9a-fA-F]')
            }
        })
    }

    /*
    * 设置空调的红外码类型
    * code详细参见文档
     */
    setCode(code) {
        let address = 76, values = [Buffer.from(['0x00', '0x02']), Buffer.from(['0x00', '0x' + code.toString(16)])]
        return this.queue.go(this._setMultiple, [address, values, this.socket])
    }

    /*
    * 设置电流参数，参数值单位：A
    * args {noiseA:0.1,thresholdA:0.3,compressorA:3.5}
    * noiseA：噪声电流（小于此值不计入电量）
    * thresholdA：状态电流（小于此值为关机，大于等于则为开机）
    * compressorA：压缩机开启电流（大于此值代表压缩机开启）
    */
    setLimitA(args) {
        let address = 87, values = []
        Object.assign(args, {
            noiseA: args.noiseA * 100,
            thresholdA: args.thresholdA * 100,
            compressorA: args.compressorA * 100
        })
        if (args.noiseA < 10000 && args.thresholdA < 10000 && args.compressorA < 10000) {
            values.push(Buffer.from(['0x' + ((args.noiseA & 0xff00) >> 8).toString(16), '0x' + (args.noiseA & 0xff).toString(16)]))
            values.push(Buffer.from(['0x' + ((args.thresholdA & 0xff00) >> 8).toString(16), '0x' + (args.thresholdA & 0xff).toString(16)]))
            values.push(Buffer.from(['0x' + ((args.compressorA & 0xff00) >> 8).toString(16), '0x' + (args.compressorA & 0xff).toString(16)]))
            return this.queue.go(this._setMultiple, [address, values, this.socket])
        } else {
            return new Promise(function (resolve, reject) {
                reject('Modbus limit current must less than 100A')
            })
        }
    }

    /*
    * 设置心跳周期，单位s，为保证服务器的性能和数据实时性，此处应该不小于30s不大于120s
    * interval Int min:30 max:120
     */
    setHeartbeat(interval) {
        let address = 21, value = Buffer.from(['0x00', '0x' + interval.toString(16)])
        return this.queue.go(this._setSingle, [address, value, this.socket])
    }

    /*
    * 控制空调
    * args {state:1,tt:20,mode:0,air:3}
     */
    setAirStatus(args) {
        // 发送控制命令
        let write = [
            Buffer.from(['0x00', args.mode ? '0x04' : '0x01']),
            Buffer.from(['0x00', '0x' + args.tt.toString(16)]),
            Buffer.from(['0x00', '0x' + args.air.toString(16)]),
            Buffer.from(['0x00', '0x' + args.state.toString(16)])
        ]
        return this.queue.go(this._setMultiple, [82, write, this.socket])
    }

    /*
    * 设置或同步空调的规则
    * args [{hour:x,minute:x,weekdays:[1,2,3],isrepeat:1,no:1,cmd:{state:1,tt:26}}]
    * 当前规则采用全部下发策略，即无论规则做什么改动，均是进行全部同步，否则会出现覆盖情况
     */
    setRules(args) {
        const that = this
        return new Promise(function (resolve, reject) {
            // 周几（当前定义1~7）、是否重复、执行时间、序号、命令
            let write = []
            if (Array.isArray(args)) {
                args.forEach((arg, i) => {
                    if (i < 10) { // 控制规则数量
                        write = write.concat(that._appendRules(arg))
                    }
                })
            } else {
                // 只有一个规则，开始
                write = write.concat(that._appendRules(args))
            }
            // 先进行规则清除，在重新设置
            that.clearRules().then(d => {
            }).catch(err => {
                logger.log('Modbus clearRules error', err)
            })
            console.log(write)
            that.queue.go(that._setMultiple, [93, write, that.socket]).then(d => {
                resolve(true)
            }).catch(err => {
                logger.log('Modbus setRules error', err)
            })
        })
    }

    /*
    * 获取当前空调设备规则
     */
    getRules() {
        const that = this
        return new Promise(function (resolve, reject) {
            // 当前仅支持10个规则，应用端应做好控制
            that.queue.go(that._getSingle, [93, 40, that.socket]).then(d => {
                // 根据规则来进行组装返回，没4位代表一个规则，硬件共支持20个规则
                let rules = []
                for (let i = 0; i < d.length; i += 4) {
                    if (i % 4 === 0) {
                        // 进行规则读取
                        let rule = {}
                        // 读取日期
                        let second = (((0xffffffff) & d[i + 1].readUInt16BE() << 16) | ((0xffffffff) & (d[i].readUInt16BE())))
                        // console.log(second)
                        Object.assign(rule, {
                            hour: parseInt(second / 3600),
                            minute: parseInt(second % 3600 / 60),
                            cmd: {state: d[i + 2].readInt8(1) === 2 ? 1 : 0, tt: d[i + 3].readInt8(1)},
                            isrepeat: !(d[i + 2].readInt8() % 2),
                            state: d[i + 3].readInt8(0) === 2 ? 1 : 0
                        })
                        //读取是否重复
                        let weeks = d[i + 2].readInt8().toString(2).split('').reverse().map((d, i) => {
                            return (parseInt(d) && i) || false
                        }).filter(d => d && true)
                        if (rule.isrepeat) {
                            rule.weeks = weeks
                        } else {
                            rule.weeks = []
                        }
                        rules.push(rule)
                    }
                }
                resolve(rules.filter(d => {
                    if (!d.hour && !d.minute && !d.cmd.tt) {
                        return false
                    }
                    return true
                }))
            })
        })
    }

    /*
    * 获取设备的coreID
     */
    getCoreID() {
        const that = this
        return new Promise(function (resolve, reject) {
            that.queue.go(that._getSingle, [173, 6, that.socket]).then(d => {
                let coreID = ''
                // 进行读取
                d.forEach(k => {
                    let before = k.readInt8().toString(16)
                    before = before.toString().length < 2 ? '0' + before : before
                    let after = k.readInt8(1).toString(16)
                    after = after.toString().length < 2 ? '0' + after : after
                    coreID = coreID + before + '' + after
                })
                resolve(coreID)
            }).catch(err => {
                reject(err)
            })
        })
    }

    /*
    * 获取设备Firmware
     */
    getFirmwareVersion() {
        const that = this
        return new Promise(function (resovle, reject) {
            that.queue.go(that._getSingle, [514, 2, that.socket]).then(d => {
                let version = 0
                d.forEach(k => {
                    version += k.readUInt16BE()
                })
                logger.log('Modbus Firmware:%s', version)
                resovle(version)
            }).catch(err => {
                reject(err)
            })
        })
    }

    /*
    * 获取其他动态属性
     */
    getOtherProperty() {
        /*
         * 获取当前空调的配置，包含以下值
         * 心跳周期（20）、空调代码（76~77）
         * 电流参数（78~90）、时钟（91~92）
         * 设备规则（93~94，95~96） * 20
        */
        const that = this
        return new Promise(function (resolve, reject) {
            let result = {}
            that.queue.go(that._getSingle, [21, 1, that.socket]).then(d => {
                result.interval = d[0].readUInt16BE()
                return that.queue.go(that._getSingle, [76, 2, that.socket])
            }).then(d => {
                result.code = d[1].readUInt16BE()
                return that.queue.go(that._getSingle, [87, 3, that.socket])
            }).then(d => {
                result.noiseA = d[0].readUInt16BE() / 100
                result.thresholdA = d[1].readUInt16BE() / 100
                result.compressorA = d[2].readUInt16BE() / 100
                return that.queue.go(that._getSingle, [91, 2, that.socket])
            }).then(d => {
                result.time = new Date((((0xffffffff) & d[1].readUInt16BE() << 16) | ((0xffffffff) & (d[0].readUInt16BE()))) * 1000)
                return that.getRules()
            }).then(d => {
                result.rules = d
                resolve(result)
            }).catch(err => {
                console.log(result)
                reject(err)
            })
        })
    }

    /*
    * 清除或删除规则
     */
    clearRules() {
        // 周几（当前定义1~7）、是否重复、执行时间、序号、命令
        let write = []
        for (let i = 0; i < 10; i++) {
            write = write.concat(this._appendRules({}, true))
        }
        console.log(write)
        return this.queue.go(this._setMultiple, [93, write, this.socket])
    }

    // 追加规则
    _appendRules(arg, clear = false) {
        let write = []
        if (clear) {
            write = write.concat([Buffer.from(['0x00', '0x00']), Buffer.from(['0x00', '0x00']), Buffer.from(['0x00', '0x00']), Buffer.from(['0x00', '0x00'])])
        } else {
            // 执行的时间点
            let time = arg.hour * 3600 + arg.minute * 60
            //write.push(Buffer.from(['0x00', '0x00']))
            write.push(Buffer.from(['0x' + ((time & 0xff00) >> 8).toString(16), '0x' + (time & 0xff).toString(16)]))
            write.push(Buffer.from(['0x' + ((time >> 16) >> 8).toString(16), '0x' + (time >> 16).toString(16)]))
            // 执行的周期
            let week = arg.isrepeat ? 0 : 1
            if (Array.isArray(arg.weekdays)) {
                arg.weekdays.forEach(day => {
                    week += Math.pow(2, day)
                })
            } else {
                week += Math.pow(2, arg.weekdays)
            }
            write.push(Buffer.from(['0x' + week.toString(16), arg.cmd.state ? '0x02' : '0x01']))
            // 此处读取出来 01 禁用 02 启用（与文档不符合）
            write.push(Buffer.from([(arg.state === 0 ? '0xfa' : '0xaf'), '0x' + arg.cmd.tt.toString(16)]))
        }
        return write
    }

    // 读取 0x03
    _getSingle(address, length, conn) {
        return new Promise(function (resolve, reject) {
            // 03 Function
            conn.readHoldingRegisters({address: address, quantity: length}, (err, info) => {
                if (err) {
                    reject(err)
                } else {
                    // 其他消息，简单处理后原样返回，1、消息类型 2、消息长度 3、起始地址 4、消息内容
                    if (global.event) {
                        global.event.publish(false, 'xlc-modbus-data', null, {
                            code: info.response.code,
                            address: address,
                            quantity: length,
                            data: info.response.data.map(b => b.readUInt16BE())
                        }, 30, moment(new Date()).toISOString(), conn.coreID);
                    }
                    resolve(info.response.data)
                }
            })
        })
    }

    // 写入一位 0x06
    _setSingle(address, value, conn) {
        return new Promise(function (resolve, reject) {
            conn.writeSingleRegister({address: address, value: value}, (err, info) => {
                if (err) {
                    reject(err)
                } else {
                    if (global.event) {
                        global.event.publish(false, 'xlc-modbus-data', null, Object.assign({}, info.response, {
                            quantity: 1,
                            data: info.response.value.readUInt16BE()
                        }), 30, moment(new Date()).toISOString(), conn.coreID);
                    }
                    resolve(info.response.value)
                }
            })
        })
    }

    // 写入多位 0x10
    _setMultiple(address, values, conn) {
        return new Promise(function (resolve, reject) {
            conn.writeMultipleRegisters({address: address, values: values}, (err, info) => {
                if (err) {
                    reject(err)
                } else {
                    if (global.event) {
                        global.event.publish(false, 'xlc-modbus-data', null, Object.assign({}, info.response, {data: values.map(b => b.readUInt16BE())}), 30, moment(new Date()).toISOString(), conn.coreID);
                    }
                    // 多位写入成功不返回数据
                    resolve(true)
                }
            })
        })
    }

    /*
    * 设备断线
     */
    disconnect(err) {
        // 设置当前连接状态
        if (this) {
            // 再次确认链接状态
            this.queue.go(this._getSingle, [21, 1, this.socket]).then(d => {
                // 触发再次活动
            }).catch(err => {
                if (err === 'TIMEOUT') {
                    this.socket.transport.stream.end()
                }
                this.state.connected = false
                this.state.lastHeart = new Date()
                this.emit('disconnect', this.state)
                this.removeAllListeners()
            })
        }
    }

    /*
    * 设备异常告警
     */
    _checkAlarm(errCode) {
        // 进行告警
        if (errCode && global.event) {
            // 获取错误信息
            let errInfo = errorCode.filter(d => d.code === errCode)[0]
            global.event.publish(false, 'xlc-modbus-alarm', null, errInfo, 30, moment(new Date()).toISOString(), this.coreID);
        }
    }
}

module.exports = SparkModbus;
