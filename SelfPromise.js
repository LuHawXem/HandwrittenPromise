const PromiseState = {
    kPending: "pending",
    kFulfilled: "resolved",
    kRejected: "rejected",
}

/**
 * @class PromiseReaction
 * @constructor
 */
class PromiseReaction {
    /**
     * @param {Function} onResolveCallback Promise状态转换为fulfilled时执行的回调函数
     * @param {Function} onRejectCallback Promise状态转换为rejected时执行的回调函数
     * @param {PromiseReaction} next 指向下一个结点的指针
     */
    constructor(onResolveCallback, onRejectCallback, next) {
        if(!new.target) throw new TypeError(`${new.target} is not a reaction`);
        this.onResolveCallback = onResolveCallback;
        this.onRejectCallback = onRejectCallback;
        this.next = next;
    }
}

/**
 * @param {SelfPromise} promise 需要resolve的promise
 * @param {any} x 用于resolve的值,可以是普通值,也可以是thenable或另一个promise
 * @param {Function} resolve 回调的resolve函数,可以不为promise的resolve函数(在递归调用时)
 * @param {Function} reject 回调的reject函数,可以不为promise的resolve函数(在递归调用时)
 * @returns {void}
 */
function resolvePromise(promise, x, resolve, reject) {
    if(promise === x) return reject(new TypeError("cylce chaining"));
    if(x !== null && (typeof x === "function" || typeof x === "object")) {
        let isCalled = false;
        try {
            let then = x.then;
            if(typeof then === "function") {
                /* thenable要在新的微任务中调用,于何处规定不明 */
                queueMicrotask(() => {
                    try {
                        then.call(x, r => {
                            if(isCalled) return;
                            isCalled = true;
                            resolvePromise(promise, r, resolve, reject);
                        }, e => {
                            if(isCalled) return;
                            isCalled = true;
                            reject(e);
                        })
                    } catch(e) {
                        if(isCalled) return;
                        isCalled = true;
                        reject(e);
                    }
                })
            }
            else {
                if(isCalled) return;
                isCalled = true;
                resolve(x);
            }
        } catch(e) {
            if(isCalled) return;
            isCalled = true;
            reject(e);
        }
    }
    else {
        resolve(x);
    }
}

/**
 * @param {PromiseReaction} reactions 回调链表
 * @param {any} result 结果值
 * @param {String} status promise的状态
 * @returns {void}
 */
function triggerPromiseReaction(reactions, result, status) {
    if(status === PromiseState.kPending) return;
    let reversed = null;
    let cur = reactions;
    while(cur) {
        let current = cur.next;
        cur.next = reversed;
        reversed = cur;
        cur = current;
    }
    cur = reversed;
    if(status === PromiseState.kFulfilled) {
        while(cur) {
            cur.onResolveCallback(result);
            cur = cur.next;
        }
    }
    else {
        while(cur) {
            cur.onRejectCallback(result);
            cur = cur.next;
        }
    }
}

/**
 * @class SelfPromise
 * @constructor
 */
class SelfPromise {
    /**
     * @param {function(resolve, reject)} exec
     */
    constructor(exec) {
        if(!new.target) throw new TypeError(`${new.target} is not a promise`);
        if(typeof exec !== "function") throw new TypeError(`${exec} resolver is not a function`);
        const self = this;
        self.status = PromiseState.kPending;
        self.reactions_or_result = null;

        /**
         * @param {any} value 
         */
        function fulfill(value) {
            self.status = PromiseState.kFulfilled;
            const reactions = self.reactions_or_result;
            self.reactions_or_result = value;
            triggerPromiseReaction(reactions, self.reactions_or_result, self.status);
        }

        /**
         * @param {any} value 
         */
        function resolve(value) {
            if(self.status === PromiseState.kPending) {
                resolvePromise(self, value, fulfill, reject);
            }
        }

        /**
         * @param {any} reason 
         */
        function reject(reason) {
            if(self.status === PromiseState.kPending) {
                self.status = PromiseState.kRejected;
                const reactions = self.reactions_or_result;
                self.reactions_or_result = reason;
                triggerPromiseReaction(reactions, self.reactions_or_result, self.status);
            }
        }

        try {
            exec(resolve, reject);
        } catch(e) {
            reject(e);
        }
    }

    /**
     * @param {any} onFulfilled resolve的处理函数或undefined
     * @param {any} onRejected reject的处理函数或undefined
     * @returns {SelfPromise}
     */
    then(onFulfilled, onRejected) {
        onFulfilled = typeof onFulfilled === "function" ? onFulfilled : x => x;
        onRejected = typeof onRejected === "function" ? onRejected : e => { throw e; };
        const self = this;
        let promise = new SelfPromise((resolve, reject) => {
            switch(self.status) {
                case PromiseState.kPending:
                    let reaction = new PromiseReaction(() => {
                        queueMicrotask(() => {
                            try {
                                let x = onFulfilled(self.reactions_or_result);
                                resolve(x);
                            } catch(e) {
                                reject(e);
                            }
                        })
                    }, () => {
                        queueMicrotask(() => {
                            try {
                                let x = onRejected(self.reactions_or_result);
                                resolve(x);
                            } catch(e) {
                                reject(e);
                            }
                        })
                    });
                    reaction.next = self.reactions_or_result;
                    self.reactions_or_result = reaction;
                    break;
                case PromiseState.kFulfilled:
                    queueMicrotask(() => {
                        try {
                            let x = onFulfilled(self.reactions_or_result);
                            resolve(x);
                        } catch(e) {
                            reject(e);
                        }
                    })
                    break;
                case PromiseState.kRejected:
                    queueMicrotask(() => {
                        try {
                            let x = onRejected(self.reactions_or_result);
                            resolve(x);
                        } catch(e) {
                            reject(e);
                        }
                    })
                    break;
            }
        })
        return promise;
    }

    /**
     * @param {any} onRejected 
     * @returns {SelfPromise}
     */
    catch(onRejected) {
        return this.then(undefined, onRejected);
    }

    /**
     * @param {any} value 
     * @returns {SelfPromise}
     */
    static resolve(value) {
        if(value instanceof SelfPromise) {
            return value;
        }
        return new SelfPromise((resolve) => {
            resolve(value);
        })
    }

    /**
     * @param {any} reason 
     * @returns {SelfPromise}
     */
    static reject(reason) {
        return new SelfPromise((_, reject) => {
            reject(reason);
        })
    }
}

SelfPromise.deferred = function() {
    let dfd = {};
    dfd.promise = new SelfPromise((resolve, reject) => {
        dfd.resolve = resolve;
        dfd.reject = reject;
    })
    return dfd;
}

module.exports = SelfPromise;