/*
* 故障位说明
* 00 无故障
* 03 设备禁用
* 04 设备未校时
* 48 云感模块掉线
* 49 遥控未匹配
* 219 禁用失败
 */
module.exports = [
    {code: 0, msg: 'Success'},
    {code: 3, msg: 'Device is disabled'},
    {code: 4, msg: 'Device uncalibrated time'},
    {code: 48, msg: 'Infrared module offline'},
    {code: 49, msg: 'Remote control is not paired'},
    {code: 219, msg: 'Device disable failed'}
]