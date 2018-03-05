const EventEmitter = require('events').EventEmitter;
const logger = require('./logger')
const rabbit = require('rabbit.js')

class EventPublisher extends EventEmitter {
    constructor(mqUrl, exchange) {
        super()
        if (!mqUrl) {
            return
        }
        const context = rabbit.createContext(mqUrl);
        this.pub = null;
        context.on('ready', () => {
            this.pub = context.socket('PUB');
            this.pub.connect(exchange);
        })
    }

    publish(isPublic, name, userid, data, ttl, published_at, coreid) {
        process.nextTick(() => {
            if (typeof(this.emit) == 'function') {
                this.emit(name, isPublic, name, userid, data, ttl, published_at, coreid);
                this.emit(coreid, isPublic, name, userid, data, ttl, published_at, coreid);
                this.emit(coreid + '/' + name, isPublic, name, userid, data, ttl, published_at, coreid);
                this.emit("*all*", isPublic, name, userid, data, ttl, published_at, coreid);
            }
        })
        if (this.pub) {
            this.pub.write(JSON.stringify({
                deviceId: coreid,
                eventname: name,
                data: data,
                publishedtime: published_at
            }), 'utf8')
        }
    }

    subscribe(name, userid, coreid, obj, objHandler) {
        let key = this.getEventName(name, userid, coreid),
            eventName;
        //coreid/name
        //coreid
        //name
        if (!obj[key + "_handler"]) {
            eventName = this.getEventName(name, coreid);
            let handler;
            if (objHandler) {
                handler = objHandler.bind(obj);
            } else {
                handler = (function (isPublic,
                                     name,
                                     userid,
                                     data,
                                     ttl,
                                     published_at,
                                     coreid) {
                    let emitName = (isPublic) ? "public" : "private";
                    if (typeof(this.emit) == 'function') {
                        this.emit(emitName, name, data, ttl, published_at, coreid);
                    }
                }).bind(obj);
            }
            obj[key + "_handler"] = handler;
            this.on(eventName, handler);
        }
    }

    getEventName(name, coreid) {
        let eventName = "";
        if (coreid) {
            eventName = coreid;
            if (name && (name != "")) {
                eventName += '/' + name;
            }
        } else if (name && (name != "")) {
            eventName = name;
        }
        if (!eventName || (eventName == "")) {
            return "*all*";
        }
        return eventName;
    }

    getEventKey(name, userid, coreid) {
        let ret = userid;
        if (coreid) {
            ret += '_' + coreid;
        }
        if (name) {
            ret += '_' + name;
        }
        return ret;
    }

    unsubscribe(name, userid, coreid, obj) {
        let key = this.getEventKey(name, userid, coreid);
        if (key) {
            let handler = obj[key + "_handler"];
            if (handler) {
                let eventName = this.getEventName(name, coreid);
                delete obj[eventName + "_handler"];
                this.removeListener(eventName, handler);
            }
        }
    }

    close() {
        try {
            this.removeAllListeners();
        }
        catch (ex) {
            logger.error("EventPublisher: error thrown during close " + ex);
        }
    }
}

module.exports = EventPublisher