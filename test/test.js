const Server = require('../index').ModbusServer

const serverInstance = new Server(8502)

//
// let ts = parseInt(new Date().getTime().toString().substr(0, 10))
// let low = (ts >> 16)
// let high = (ts & 65535)
// let time = Buffer.from(['0x' + ((low & 0xff00) >> 8).toString(16), '0x' + (low & 0xff).toString(16)])
// let time1 = Buffer.from(['0x' + ((high & 0xff00) >> 8).toString(16), '0x' + (high & 0xff).toString(16)])
//
// console.log(low, high, time, time1)
//
// let buf = Buffer.from([0xf2, 0xff])
// console.log(buf.readUInt16BE())
// return
// console.log(buf.readInt8())
// console.log(buf.readInt8(1))
// console.log((1 + 2 + 4 + 8 + 64 + 128).toString(2).split('').reverse())
// let w = (2 + 4 + 8 + 64 + 128).toString(2).split('').reverse().map((d, i) => {
//     return (parseInt(d) && i) || false
// }).filter(d => d && true)
// console.log(w)
//
// let buf = [Buffer.from(['0x07', '0xdc']), Buffer.from(['0x00', '0x00'])]
// console.log(buf.map(b=>b.readUInt16BE()))
// return
// return
// console.log(Buffer.from(['0x' + ((9999 & 0xff00) >> 8).toString(16), '0x' + (9999 & 0xff).toString(16)]))
// let time = 23 * 3600 + 0 * 60
// let write = []
// write = write.concat([Buffer.from(['0x' + ((time & 0xff00) >> 8).toString(16), '0x' + (time & 0xff).toString(16)])])
// write.push(Buffer.from(['0x' + ((time >> 16) >> 8).toString(16), '0x' + (time >> 16).toString(16)]))
// console.log(write)
// return
// //

// let second = (((0xffffffff) & 0 << 16) | ((0xffffffff) & (59400)))
// console.log(second)
// return
serverInstance.start()

serverInstance.on('online', coreID => {
    // 获取实例
    const core = serverInstance.getCoreByCoreID(coreID)
    // console.log(core.prototype)
    // for (var i in core) {
    //     if (core.hasOwnProperty(i) && typeof core[i] == "function") {
    //         console.log("对象方法: ", i, "=", core[i])
    //     }
    // }
    if (core && core.state.connected) {
        // 进行操作，比如监听事件，或者调用操作
        core.on('heartbeat', d => {
            console.log('接收到心跳消息', JSON.stringify(d))
        })
        // 进行规则自动同步(如何设备的规则呢，这是个问题啊，调用DMI??token问题??）
        core.setHeartbeat(30).then(d => {
            console.log('setHeartbeat', d)
        })
        core.setAirStatus({state: 1, tt: 29, mode: 1, air: 3}).then(d => {
            console.log('setAirStatus', d)
        })
    }
})

serverInstance.on('offline', coreID => {

})

function test(core) {
    // 设置coreID
    // core.setCoreID('220055000551363036373537').then(d => {
    //     console.log('setCoreID', d)
    // }).catch(err => {
    //     console.log(err)
    // })
    // 设置心跳时间
    // core.setHeartbeat(30).then(d => {
    //     console.log('setHeartbeat', d)
    // })
    // 设置code
    // core.setCode(160).then(d => {
    //     console.log('setCode', d)
    // })
    // 设置状态
    // core.setAirStatus({state: 1, tt: 29, mode: 1, air: 3}).then(d => {
    //     console.log('setAirStatus', d)
    // })
    // 设置规则
    // core.setRules([{
    //     hour: 8,
    //     minute: 15,
    //     weekdays: [1, 2, 3, 4, 5],
    //     isrepeat: 1,
    //     cmd: {state: 1, tt: 26}
    // }, {
    //     hour: 16,
    //     minute: 30,
    //     weekdays: [1, 2, 3, 4, 5],
    //     isrepeat: 1,
    //     cmd: {state: 0, tt: 16}
    // }, {
    //     hour: 12,
    //     minute: 0,
    //     weekdays: [1, 2, 3, 4, 5],
    //     isrepeat: 1,
    //     cmd: {state: 0, tt: 16}
    // }, {
    //     hour: 13,
    //     minute: 30,
    //     weekdays: [1, 2, 3, 4, 5],
    //     isrepeat: 1,
    //     cmd: {state: 1, tt: 24}
    // }, {
    //     hour: 17,
    //     minute: 32,
    //     weekdays: [],
    //     isrepeat: 0,
    //     cmd: {state: 1, tt: 24}
    // }
    // ]).then(d => {
    //     console.log('setRules')
    //     return core.getRules()
    // }).then(d => {
    //     console.log('getRules', d)
    // })
    // 设置电流阈值
    core.setLimitA({noiseA: 0.1, thresholdA: 0.5, compressorA: 4}).then(d => {
        console.log('setLimitA')
    })
    // 获取其他状态信息
    core.getOtherProperty().then(function (result) {
        console.log('结果', JSON.stringify(result))
    })
}

process.on('uncaughtException', function (err) {
    console.log('process.on handler');
    console.log(err);
});

