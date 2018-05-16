'use strict';

const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const assert = require('chai').assert;
const dataDriven = require('data-driven');
const deepFreeze = require('deep-freeze');
const ChildProcess = require('child_process').ChildProcess;
const {Readable, Writable} = require('stream');

const NvidiaGpuMonitor = require('../../index');

const coresStatOutput = fs.readFileSync(path.resolve(__dirname, 'data/gpuStat.txt'), 'utf8');

/**
 * Returns object with passed to function variable itself and its type.
 *
 * As of 'null' has type of 'object' in ECMAScript, function returns 'null' for it.
 *
 * @example
 *   `{value: 123, type: 'number'}`
 *   '{value: Symbol(), type: 'symbol'}`
 *   `{value: null, type: 'null'}`
 *
 * @param {*} value - value of any type
 * @returns {{value: *, type: string}}
 */
function vt(value) {
    return {value, type: (value === null ? 'null' : typeof value)};
}

const testParams = {
    // all type except number
    notANumber: [
        vt('8080'), vt(true), vt(undefined), vt(Symbol()), vt({}), vt(setTimeout), vt(null)
    ],
    // all types except string
    notAString: [
        vt(true), vt(123), vt(undefined), vt(Symbol()), vt({}), vt(setTimeout), vt(null)
    ],
    // all types except an object
    notAnObject: [
        vt('8080'), vt(123), vt(true), vt(undefined), vt(Symbol()), vt(setTimeout), vt(null)
    ]
};
const coreNumbers = new Set([0, 1]);
const gpuCoresMem = deepFreeze({
    0: {
        total: 10,
        free: 8
    },
    1: {
        total: 10,
        free: 5
    }
});
const gpuEncodersUtilization = deepFreeze({
    0: 1,
    1: 6
});
const gpuDecodersUtilization = deepFreeze({
    0: 2,
    1: 6
});
const gpuProductName = {
    0: 'Tesla M60',
    1: 'Tesla M61'
};
const gpuDriverVersion = '384.111';

describe('NvidiaGpuMonitor::constructor', () => {
    dataDriven(testParams.notAString, function () {
        it('incorrect type of nvidiaSmiPath, type = {type}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: arg.value
                    });
                },
                TypeError,
                'field "nvidiaSmiPath" is required and must be a string');
        });
    });

    dataDriven(testParams.notANumber, function () {
        it('incorrect type of checkIntervalSec, type = {type}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkIntervalSec: arg.value
                    });
                },
                TypeError,
                'field "checkIntervalSec" is required and must be an integer and not less than 1');
        });
    });

    dataDriven(testParams.notAnObject, function () {
        it('incorrect type of mem, type = {type}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkIntervalSec: 1000,
                        mem: arg.value
                    });
                },
                TypeError,
                'field "mem" is required and must be an object');
        });
    });

    it('incorrect config value mem.thresholdType', () => {
        assert.throws(
            () => {
                new NvidiaGpuMonitor({
                    nvidiaSmiPath: '',
                    checkIntervalSec: 1000,
                    mem: {
                        thresholdType: 'sma'
                    }
                });
            },
            TypeError,
            '"mem.thresholdType" is not set or has invalid type');
    });

    dataDriven([vt(-1), vt(0)], function () {
        it('incorrect config value "minFree" for mem.thresholdType === "fixed", value = {value}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkIntervalSec: 1000,
                        mem: {
                            thresholdType: 'fixed',
                            minFree: arg.value
                        }
                    });
                },
                TypeError,
                '"mem.minFree" field is required for threshold = fixed and must be more than 0');
        });
    });

    dataDriven([vt(undefined), vt(-1), vt(0), vt(1), vt(10)], function () {
        it('incorrect config value "highWatermark" for mem.thresholdType === "rate", value = {value}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkIntervalSec: 1000,
                        mem: {
                            thresholdType: 'rate',
                            highWatermark: arg.value
                        }
                    });
                },
                TypeError,
                '"mem.highWatermark" field is required for threshold = "rate" and must be in range (0;1)');
        });
    });

    dataDriven(testParams.notAnObject, function () {
        it('incorrect type of encoder, type = {type}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkIntervalSec: 1000,
                        mem: {
                            thresholdType: 'none'
                        },
                        encoder: arg.value
                    });
                },
                TypeError,
                'field "encoder" is required and must be an object');
        });
    });

    it('incorrect config value encoder.calculationAlgo', () => {
        assert.throws(
            () => {
                new NvidiaGpuMonitor({
                    nvidiaSmiPath: '',
                    checkIntervalSec: 1000,
                    mem: {
                        thresholdType: 'none'
                    },
                    encoder: {
                        calculationAlgo: undefined
                    },
                });
            },
            TypeError,
            '"encoder.calculationAlgo" is not set or has invalid type');
    });

    dataDriven([vt(undefined), vt(1), vt(-1), vt(0.2), vt(5.2)], function () {
        it('incorrect config value "periodPoints" for encoder.calculationAlgo === "sma", value = {value}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkIntervalSec: 1000,
                        mem: {
                            thresholdType: 'none'
                        },
                        encoder: {
                            calculationAlgo: 'sma',
                            periodPoints: arg.value
                        }
                    });
                },
                TypeError,
                '"encoder.periodPoints" field is required for SMA algorithm and must be more than 1');
        });
    });

    it('incorrect config value encoder.thresholdType', () => {
        assert.throws(
            () => {
                new NvidiaGpuMonitor({
                    nvidiaSmiPath: '',
                    checkIntervalSec: 1000,
                    mem: {
                        thresholdType: 'none'
                    },
                    encoder: {
                        calculationAlgo: 'sma',
                        periodPoints: 3
                    }
                });
            },
            TypeError,
            '"encoder.thresholdType" is not set or has invalid type');
    });

    dataDriven([vt(undefined), vt(-1), vt(0), vt(1), vt(10)], function () {
        it('incorrect config value "highWatermark" for encoder.thresholdType === "rate", value = {value}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkIntervalSec: 1000,
                        mem: {
                            thresholdType: 'none'
                        },
                        encoder: {
                            calculationAlgo: 'sma',
                            periodPoints: 3,
                            thresholdType: 'rate',
                            highWatermark: arg.value
                        }
                    });
                },
                TypeError,
                '"encoder.highWatermark" field is required for threshold = "rate" and must be in range (0,1)');
        });
    });

    dataDriven(testParams.notAnObject, function () {
        it('incorrect type of decoder, type = {type}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkIntervalSec: 1000,
                        mem: {
                            thresholdType: 'none'
                        },
                        encoder: {
                            calculationAlgo: 'last_value',
                            thresholdType: 'none',
                        },
                        decoder: arg.value
                    });
                },
                TypeError,
                'field "decoder" is required and must be an object');
        });
    });

    it('incorrect config value decoder.calculationAlgo', () => {
        assert.throws(
            () => {
                new NvidiaGpuMonitor({
                    nvidiaSmiPath: '',
                    checkIntervalSec: 1000,
                    mem: {
                        thresholdType: 'none'
                    },
                    encoder: {
                        calculationAlgo: 'last_value',
                        thresholdType: 'none',
                    },
                    decoder: {
                        calculationAlgo: undefined
                    },
                });
            },
            TypeError,
            '"decoder.calculationAlgo" is not set or has invalid type');
    });

    dataDriven([vt(undefined), vt(-1), vt(0.2), vt(5.2)], function () {
        it('incorrect config value "periodPoints" for decoder.calculationAlgo === "sma", value = {value}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkIntervalSec: 1000,
                        mem: {
                            thresholdType: 'none'
                        },
                        encoder: {
                            calculationAlgo: 'last_value',
                            thresholdType: 'none',
                        },
                        decoder: {
                            calculationAlgo: 'sma',
                            periodPoints: arg.value
                        }
                    });
                },
                TypeError,
                '"decoder.periodPoints" field is required for SMA algorithm and must be more than 1');
        });
    });

    it('incorrect config value decoder.thresholdType', () => {
        assert.throws(
            () => {
                new NvidiaGpuMonitor({
                    nvidiaSmiPath: '',
                    checkIntervalSec: 1000,
                    mem: {
                        thresholdType: 'none'
                    },
                    encoder: {
                        calculationAlgo: 'last_value',
                        thresholdType: 'none',
                    },
                    decoder: {
                        calculationAlgo: 'sma',
                        periodPoints: 3
                    }
                });
            },
            TypeError,
            '"decoder.thresholdType" is not set or has invalid type');
    });

    dataDriven([vt(undefined), vt(-1), vt(0), vt(1), vt(10)], function () {
        it('incorrect config value "highWatermark" for decoder.thresholdType === "rate", value = {value}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkIntervalSec: 1000,
                        mem: {
                            thresholdType: 'none'
                        },
                        encoder: {
                            calculationAlgo: 'last_value',
                            thresholdType: 'none',
                        },
                        decoder: {
                            calculationAlgo: 'sma',
                            periodPoints: 3,
                            thresholdType: 'rate',
                            highWatermark: arg.value
                        }
                    });
                },
                TypeError,
                '"decoder.highWatermark" field is required for threshold = "rate" and must be in range (0,1)');
        });
    });
});

describe('NvidiaGpuMonitor methods tests', () => {
    const monitorConf = {
        nvidiaSmiPath: '/usr/bin/nvidia-sma',
        gpuStatPath: './tests/coresStatOutput.txt',
        checkIntervalSec: 1,
        mem: {
            thresholdType: 'none',
            minFree: 1024,
            highWatermark: 0.75
        },
        encoder: {
            calculationAlgo: 'sma',
            thresholdType: 'none',
            periodPoints: 5,
            highWatermark: 0.75
        },
        decoder: {
            calculationAlgo: 'sma',
            thresholdType: 'none',
            periodPoints: 5,
            highWatermark: 0.75
        }
    };

    let nvidiaGpuMonitor;

    beforeEach(() => {
        nvidiaGpuMonitor = new NvidiaGpuMonitor(monitorConf);
    });

    it('start() successfully', async () => {
        const expectedCoreNumbers = deepFreeze([0, 1]);

        const runNvidiaSmiWatcherStub = sinon.stub(nvidiaGpuMonitor, '_runNvidiaSmiWatcher');
        const parseGpuMetaDataStub = sinon.stub(nvidiaGpuMonitor._nvidiaGpuInfo, 'parseGpuMetaData');
        sinon.stub(nvidiaGpuMonitor._nvidiaGpuInfo, 'getCoreNumbers').returns(expectedCoreNumbers);

        const coreNumbers = await nvidiaGpuMonitor.start();

        assert.deepEqual(coreNumbers, expectedCoreNumbers);
        assert.equal(nvidiaGpuMonitor._status, NvidiaGpuMonitor.STATUS_STARTED);
        assert.isTrue(runNvidiaSmiWatcherStub.calledOnce);
        assert.isTrue(runNvidiaSmiWatcherStub.calledWithExactly());
        assert.isTrue(parseGpuMetaDataStub.calledOnce);
        assert.isTrue(parseGpuMetaDataStub.calledWithExactly());
    });

    it('second start() call throws error', async () => {
        const runNvidiaSmiWatcherStub = sinon.stub(nvidiaGpuMonitor, '_runNvidiaSmiWatcher');
        const parseGpuMetaDataStub = sinon.stub(nvidiaGpuMonitor._nvidiaGpuInfo, 'parseGpuMetaData');

        await nvidiaGpuMonitor.start();

        try {
            await nvidiaGpuMonitor.start();
            assert.fail('service second start success', 'service second start throw error');
        } catch (err) {
            assert.instanceOf(err, Error);
            assert.equal(err.message, 'NvidiaGpuMonitor service is already started');
            assert.equal(nvidiaGpuMonitor._status, NvidiaGpuMonitor.STATUS_STARTED);
            assert.isTrue(runNvidiaSmiWatcherStub.calledOnce);
            assert.isTrue(runNvidiaSmiWatcherStub.calledWithExactly());
            assert.isTrue(parseGpuMetaDataStub.calledOnce);
            assert.isTrue(parseGpuMetaDataStub.calledWithExactly());
        }
    });

    it('stop() destroy child process and set STOPPING status', () => {
        const expectedTimer = setTimeout(() => {}, 100);

        const clock = sinon.useFakeTimers();
        nvidiaGpuMonitor._status = NvidiaGpuMonitor.STATUS_STARTED;
        nvidiaGpuMonitor._dmonWatcher = sinon.createStubInstance(ChildProcess);
        const clearTimeoutSpy = sinon.spy(clock, 'clearTimeout');
        nvidiaGpuMonitor._healthyTimer = expectedTimer;

        nvidiaGpuMonitor.stop();

        assert.isTrue(clearTimeoutSpy.calledOnce);
        assert.isTrue(clearTimeoutSpy.calledWithExactly(expectedTimer));
        assert.isUndefined(nvidiaGpuMonitor._healthyTimer);
        assert.isTrue(nvidiaGpuMonitor._dmonWatcher.kill.calledOnce);
        assert.isTrue(nvidiaGpuMonitor._dmonWatcher.kill.calledWithExactly());
        assert.equal(nvidiaGpuMonitor._status, NvidiaGpuMonitor.STATUS_STOPPING);
        assert.equal(nvidiaGpuMonitor._healthy, false);

        clock.restore();
    });

    it('stop() cancels auto restart if _restartTimer is setted', () => {
        const expectedTimer = setTimeout(() => {}, 100);

        const clock = sinon.useFakeTimers();
        nvidiaGpuMonitor._status = NvidiaGpuMonitor.STATUS_STARTED;
        nvidiaGpuMonitor._dmonWatcher = sinon.createStubInstance(ChildProcess);
        const clearTimeoutSpy = sinon.spy(clock, 'clearTimeout');
        nvidiaGpuMonitor._restartTimer = expectedTimer;

        let isStoppedFired = false;
        nvidiaGpuMonitor.on('stopped', () => {
            isStoppedFired = true;
        });

        nvidiaGpuMonitor.stop();

        assert.isTrue(clearTimeoutSpy.calledOnce);
        assert.isTrue(clearTimeoutSpy.calledWithExactly(expectedTimer));
        assert.isUndefined(nvidiaGpuMonitor._restartTimer);
        assert.isTrue(nvidiaGpuMonitor._dmonWatcher.kill.notCalled);
        assert.equal(nvidiaGpuMonitor._status, NvidiaGpuMonitor.STATUS_STOPPED);
        assert.equal(isStoppedFired, true);
        assert.equal(nvidiaGpuMonitor._healthy, false);

        clock.restore();
    });

    it('_watcherErrorHandler() emits error and unhealthy', () => {
        const expectedError = new Error('Some error');

        let firedError;
        nvidiaGpuMonitor.on('error', err => {
            firedError = err;
        });

        let isUnhealthyFired = false;
        nvidiaGpuMonitor.on('unhealthy', () => {
            isUnhealthyFired = true;
        });

        nvidiaGpuMonitor._healthy = true;
        nvidiaGpuMonitor._watcherErrorHandler(expectedError);

        assert.equal(nvidiaGpuMonitor._healthy, false);
        assert.equal(firedError.message, expectedError.message);
        assert.equal(isUnhealthyFired, true);
    });

    it('_watcherExitHandler() sets STOPPED status if stop() was called', () => {
        nvidiaGpuMonitor._dmonWatcher = sinon.createStubInstance(ChildProcess);
        nvidiaGpuMonitor._dmonWatcher.stdout = sinon.createStubInstance(Readable);
        nvidiaGpuMonitor._dmonWatcher.stderr = sinon.createStubInstance(Readable);
        nvidiaGpuMonitor._dmonWatcher.stdin = sinon.createStubInstance(Writable);

        let isStoppedFired = false;
        nvidiaGpuMonitor.on('stopped', () => {
            isStoppedFired = true;
        });

        nvidiaGpuMonitor._status = NvidiaGpuMonitor.STATUS_STOPPING;
        nvidiaGpuMonitor._watcherExitHandler(1, null);

        assert.isTrue(nvidiaGpuMonitor._dmonWatcher.stdout.removeAllListeners.calledOnce);
        assert.isTrue(nvidiaGpuMonitor._dmonWatcher.stdout.destroy.calledOnce);
        assert.isTrue(nvidiaGpuMonitor._dmonWatcher.stderr.destroy.calledOnce);
        assert.isTrue(nvidiaGpuMonitor._dmonWatcher.stdin.destroy.calledOnce);
        assert.equal(nvidiaGpuMonitor._status, NvidiaGpuMonitor.STATUS_STOPPED);
        assert.equal(isStoppedFired, true);
        assert.equal(nvidiaGpuMonitor._healthy, false);
    });

    it('_watcherExitHandler() calls auto-restart if stop() was not called', () => {
        const expectedError = new Error('"nvidia-smi dmon" finished with code 1');

        const clock = sinon.useFakeTimers();
        const setTimeoutSpy = sinon.spy(clock, 'setTimeout');
        nvidiaGpuMonitor._dmonWatcher = sinon.createStubInstance(ChildProcess);
        nvidiaGpuMonitor._dmonWatcher.stdout = sinon.createStubInstance(Readable);
        nvidiaGpuMonitor._dmonWatcher.stderr = sinon.createStubInstance(Readable);
        nvidiaGpuMonitor._dmonWatcher.stdin = sinon.createStubInstance(Writable);

        let firedError;
        nvidiaGpuMonitor.on('error', err => {
            firedError = err;
        });

        let isUnhealthyFired = false;
        nvidiaGpuMonitor.on('unhealthy', () => {
            isUnhealthyFired = true;
        });

        let isStoppedFired = false;
        nvidiaGpuMonitor.on('stopped', () => {
            isStoppedFired = true;
        });

        nvidiaGpuMonitor._healthy = true;
        nvidiaGpuMonitor._status = NvidiaGpuMonitor.STATUS_STARTED;
        nvidiaGpuMonitor._watcherExitHandler(1, null);

        assert.equal(nvidiaGpuMonitor._healthy, false);
        assert.equal(firedError.message, expectedError.message);
        assert.equal(isUnhealthyFired, true);
        assert.isTrue(nvidiaGpuMonitor._dmonWatcher.stdout.removeAllListeners.calledOnce);
        assert.isTrue(nvidiaGpuMonitor._dmonWatcher.stdout.destroy.calledOnce);
        assert.isTrue(nvidiaGpuMonitor._dmonWatcher.stderr.destroy.calledOnce);
        assert.isTrue(nvidiaGpuMonitor._dmonWatcher.stdin.destroy.calledOnce);
        assert.equal(nvidiaGpuMonitor._status, NvidiaGpuMonitor.STATUS_STARTED);
        assert.equal(isStoppedFired, false);
        assert.equal(nvidiaGpuMonitor._healthy, false);
        assert.notEqual(nvidiaGpuMonitor._restartTimer, undefined);
        assert.isTrue(setTimeoutSpy.calledOnce);
        assert.isTrue(setTimeoutSpy.calledWithExactly(nvidiaGpuMonitor._runNvidiaSmiWatcher, 1000));

        clock.reset();
    });

    it('_processGpuCoreInfo() clears _healthyTimer, skips string processing that not matches with pattern' +
        ', and sets _healthyTimer again', () => {
        const expectedTimer = setTimeout(() => {}, 100);

        const clock = sinon.useFakeTimers();
        const setTimeoutSpy = sinon.spy(clock, 'setTimeout');
        const clearTimeoutSpy = sinon.spy(clock, 'clearTimeout');
        nvidiaGpuMonitor._healthyTimer = expectedTimer;
        nvidiaGpuMonitor._healthy = true;

        let isHealthyFired = false;
        nvidiaGpuMonitor.on('healthy', () => {
            isHealthyFired = true;
        });

        let isUnhealthyFired = false;
        nvidiaGpuMonitor.on('unhealthy', () => {
            isUnhealthyFired = true;
        });

        const coreInfoHeaders = coresStatOutput.split('\n')[0];
        nvidiaGpuMonitor._processGpuCoreInfo(coreInfoHeaders);

        assert.equal(nvidiaGpuMonitor._coreNumbers.size, 0);
        assert.equal(nvidiaGpuMonitor._tmpCoreNumbers.size, 0);
        assert.equal(isHealthyFired, false);
        assert.equal(isUnhealthyFired, false);
        assert.equal(nvidiaGpuMonitor._healthy, true);
        assert.isTrue(clearTimeoutSpy.calledOnce);
        assert.isTrue(clearTimeoutSpy.calledWithExactly(expectedTimer));
        assert.isTrue(setTimeoutSpy.calledOnce);
        assert.isTrue(clearTimeoutSpy.calledBefore(setTimeoutSpy));
        assert.notEqual(nvidiaGpuMonitor._healthyTimer, undefined);

        clock.reset();
    });

    it('firing "unhealthy" event on _healthyTimer finish', () => {
        const expectedTimer = setTimeout(() => {}, 100);

        const clock = sinon.useFakeTimers();
        const setTimeoutSpy = sinon.spy(clock, 'setTimeout');
        const clearTimeoutSpy = sinon.spy(clock, 'clearTimeout');
        nvidiaGpuMonitor._healthyTimer = expectedTimer;
        nvidiaGpuMonitor._healthy = true;

        let isHealthyFired = false;
        nvidiaGpuMonitor.on('healthy', () => {
            isHealthyFired = true;
        });

        let isUnhealthyFired = false;
        nvidiaGpuMonitor.on('unhealthy', () => {
            isUnhealthyFired = true;
        });

        const coreInfoHeaders = coresStatOutput.split('\n')[0];
        nvidiaGpuMonitor._processGpuCoreInfo(coreInfoHeaders);

        clock.tick(monitorConf.checkIntervalSec * 2 * 1000 + 1);

        assert.equal(nvidiaGpuMonitor._coreNumbers.size, 0);
        assert.equal(nvidiaGpuMonitor._tmpCoreNumbers.size, 0);
        assert.equal(isHealthyFired, false);
        assert.equal(isUnhealthyFired, true);
        assert.equal(nvidiaGpuMonitor._healthy, false);
        assert.isTrue(clearTimeoutSpy.calledOnce);
        assert.isTrue(clearTimeoutSpy.calledWithExactly(expectedTimer));
        assert.isTrue(setTimeoutSpy.calledOnce);
        assert.isTrue(clearTimeoutSpy.calledBefore(setTimeoutSpy));
        assert.notEqual(nvidiaGpuMonitor._healthyTimer, undefined);

        clock.reset();
    });

    it('_processGpuCoreInfo() parses gpu core info and saves state and emits "healthy"', () => {
        const expectedTimer = setTimeout(() => {}, 100);
        const expectedCoreNumber = 0;
        const expectedMem = {
            0: {
                total: 8000,
                free: 8000 - 146
            }
        };
        const expectedEnc = {0: 2};
        const expectedDec = {0: 1};

        const clock = sinon.useFakeTimers();
        const setTimeoutSpy = sinon.spy(clock, 'setTimeout');
        const clearTimeoutSpy = sinon.spy(clock, 'clearTimeout');
        const processCoresStatisticSpy = sinon.spy(nvidiaGpuMonitor, '_processCoresStatistic');
        nvidiaGpuMonitor._healthyTimer = expectedTimer;
        nvidiaGpuMonitor._healthy = false;
        nvidiaGpuMonitor._nvidiaGpuInfo = {
            getTotalMemory: sinon.stub().returns(8000),
            getCoreNumbers: sinon.stub().returns([0, 1, 2, 3])
        };

        let isHealthyFired = false;
        nvidiaGpuMonitor.on('healthy', () => {
            isHealthyFired = true;
        });

        let isUnhealthyFired = false;
        nvidiaGpuMonitor.on('unhealthy', () => {
            isUnhealthyFired = true;
        });

        const coreInfoHeaders = coresStatOutput.split('\n')[2];
        nvidiaGpuMonitor._processGpuCoreInfo(coreInfoHeaders);

        assert.equal(nvidiaGpuMonitor._coreNumbers.size, 0);
        assert.equal(nvidiaGpuMonitor._tmpCoreNumbers.size, 1);
        assert.strictEqual(nvidiaGpuMonitor._tmpCoreNumbers.has(expectedCoreNumber), true);
        assert.deepEqual(nvidiaGpuMonitor._gpuCoresMem, expectedMem);
        assert.deepEqual(nvidiaGpuMonitor._gpuEncodersUtilization, expectedEnc);
        assert.deepEqual(nvidiaGpuMonitor._gpuDecodersUtilization, expectedDec);
        assert.strictEqual(isHealthyFired, true);
        assert.strictEqual(isUnhealthyFired, false);
        assert.strictEqual(nvidiaGpuMonitor._healthy, true);
        assert.isTrue(nvidiaGpuMonitor._nvidiaGpuInfo.getTotalMemory.calledOnce);
        assert.isTrue(nvidiaGpuMonitor._nvidiaGpuInfo.getTotalMemory.calledWithExactly(expectedCoreNumber));
        assert.isTrue(nvidiaGpuMonitor._nvidiaGpuInfo.getCoreNumbers.calledOnce);
        assert.isTrue(nvidiaGpuMonitor._nvidiaGpuInfo.getCoreNumbers.calledWithExactly());
        assert.isTrue(processCoresStatisticSpy.notCalled);
        assert.isTrue(clearTimeoutSpy.calledOnce);
        assert.isTrue(clearTimeoutSpy.calledWithExactly(expectedTimer));
        assert.isTrue(setTimeoutSpy.calledOnce);
        assert.isTrue(clearTimeoutSpy.calledBefore(setTimeoutSpy));
        assert.notEqual(nvidiaGpuMonitor._healthyTimer, undefined);

        clock.reset();
    });

    it('_processGpuCoreInfo() parses all cores info and saves state', () => {
        const expectedCoreNumbers = deepFreeze([0, 1, 2, 3]);
        const expectedMem = {
            0: {
                total: 8000,
                free: 8000 - 146
            },
            1: {
                total: 8000,
                free: 8000
            },
            2: {
                total: 8000,
                free: 8000
            },
            3: {
                total: 8000,
                free: 8000
            },
        };
        const expectedEnc = {};
        const expectedDec = {};

        const clock = sinon.useFakeTimers();
        const setTimeoutSpy = sinon.spy(clock, 'setTimeout');
        const clearTimeoutSpy = sinon.spy(clock, 'clearTimeout');
        const processCoresStatisticSpy = sinon.spy(nvidiaGpuMonitor, '_processCoresStatistic');
        nvidiaGpuMonitor._healthy = true;
        nvidiaGpuMonitor._nvidiaGpuInfo = {
            getTotalMemory: sinon.stub().returns(8000),
            getCoreNumbers: sinon.stub().returns(expectedCoreNumbers)
        };

        let isHealthyFired = false;
        nvidiaGpuMonitor.on('healthy', () => {
            isHealthyFired = true;
        });

        let isUnhealthyFired = false;
        nvidiaGpuMonitor.on('unhealthy', () => {
            isUnhealthyFired = true;
        });

        for (const coreInfo of coresStatOutput.split('\n').splice(0, 6)) {
            nvidiaGpuMonitor._processGpuCoreInfo(coreInfo);
        }

        assert.equal(nvidiaGpuMonitor._coreNumbers.size, 4);
        assert.equal(nvidiaGpuMonitor._tmpCoreNumbers.size, 0);
        assert.deepEqual(Array.from(nvidiaGpuMonitor._coreNumbers.values()), expectedCoreNumbers);
        assert.deepEqual(nvidiaGpuMonitor._gpuCoresMem, expectedMem);
        assert.deepEqual(nvidiaGpuMonitor._gpuEncodersUtilization, expectedEnc);
        assert.deepEqual(nvidiaGpuMonitor._gpuDecodersUtilization, expectedDec);
        assert.strictEqual(isHealthyFired, false);
        assert.strictEqual(isUnhealthyFired, false);
        assert.strictEqual(nvidiaGpuMonitor._healthy, true);
        assert.equal(nvidiaGpuMonitor._nvidiaGpuInfo.getTotalMemory.callCount, 4);
        assert.equal(nvidiaGpuMonitor._nvidiaGpuInfo.getCoreNumbers.callCount, 4);
        assert.isTrue(processCoresStatisticSpy.calledOnce);
        assert.equal(clearTimeoutSpy.callCount, 5);
        assert.equal(setTimeoutSpy.callCount, 6);
        assert.notEqual(nvidiaGpuMonitor._healthyTimer, undefined);

        clock.reset();
    });

    it('_processGpuCoreInfo() parses all cores info and detect problem with some core', () => {
        const expectedCoreNumbers = deepFreeze([0, 1, 2]);
        const expectedMem = {
            0: {
                total: 8000,
                free: 8000 - 146
            },
            1: {
                total: 8000,
                free: 8000
            },
            2: {
                total: 8000,
                free: 8000
            }
        };

        const expectedEnc = {0: 2};
        const expectedDec = {0: 1};

        const clock = sinon.useFakeTimers();
        const setTimeoutSpy = sinon.spy(clock, 'setTimeout');
        const clearTimeoutSpy = sinon.spy(clock, 'clearTimeout');
        const processCoresStatisticSpy = sinon.spy(nvidiaGpuMonitor, '_processCoresStatistic');
        nvidiaGpuMonitor._healthy = true;
        nvidiaGpuMonitor._nvidiaGpuInfo = {
            getTotalMemory: sinon.stub().returns(8000),
            getCoreNumbers: sinon.stub().returns([0, 1, 2, 3])
        };

        let isHealthyFired = false;
        nvidiaGpuMonitor.on('healthy', () => {
            isHealthyFired = true;
        });

        let isUnhealthyFired = false;
        nvidiaGpuMonitor.on('unhealthy', () => {
            isUnhealthyFired = true;
        });

        const strings = coresStatOutput.split('\n');
        const mockData = [
            strings[0],
            strings[1],
            strings[2],
            strings[3],
            strings[4],
            strings[2],
        ];

        for (const coreInfo of mockData) {
            nvidiaGpuMonitor._processGpuCoreInfo(coreInfo);
        }

        assert.equal(nvidiaGpuMonitor._coreNumbers.size, 3);
        assert.equal(nvidiaGpuMonitor._tmpCoreNumbers.size, 1);
        assert.deepEqual(Array.from(nvidiaGpuMonitor._coreNumbers.values()), expectedCoreNumbers);
        assert.deepEqual(nvidiaGpuMonitor._tmpCoreNumbers.has(0), true);
        assert.deepEqual(nvidiaGpuMonitor._gpuCoresMem, expectedMem);
        assert.deepEqual(nvidiaGpuMonitor._gpuEncodersUtilization, expectedEnc);
        assert.deepEqual(nvidiaGpuMonitor._gpuDecodersUtilization, expectedDec);
        assert.strictEqual(isHealthyFired, false);
        assert.strictEqual(isUnhealthyFired, false);
        assert.strictEqual(nvidiaGpuMonitor._healthy, true);
        assert.equal(nvidiaGpuMonitor._nvidiaGpuInfo.getTotalMemory.callCount, 4);
        assert.equal(nvidiaGpuMonitor._nvidiaGpuInfo.getCoreNumbers.callCount, 4);
        assert.isTrue(processCoresStatisticSpy.calledOnce);
        assert.equal(clearTimeoutSpy.callCount, 5);
        assert.equal(setTimeoutSpy.callCount, 6);
        assert.notEqual(nvidiaGpuMonitor._healthyTimer, undefined);

        clock.reset();
    });

    it('getGpuStatistic() returns array with cores statistic', () => {
        const expectedCoreStat1 = {
            core: 0,
            mem: {
                free: gpuCoresMem[0].free
            },
            usage: {
                enc: gpuEncodersUtilization[0],
                dec: gpuDecodersUtilization[0],
            }
        };

        const expectedCoreStat2 = {
            core: 1,
            mem: {
                free: gpuCoresMem[1].free
            },
            usage: {
                enc: gpuEncodersUtilization[1],
                dec: gpuDecodersUtilization[1],
            }
        };

        nvidiaGpuMonitor._status = NvidiaGpuMonitor.STATUS_STARTED;
        nvidiaGpuMonitor._coreNumbers = coreNumbers;
        nvidiaGpuMonitor._gpuCoresMem = gpuCoresMem;
        nvidiaGpuMonitor._gpuEncodersUsage = gpuEncodersUtilization;
        nvidiaGpuMonitor._gpuDecodersUsage = gpuDecodersUtilization;
        nvidiaGpuMonitor._nvidiaGpuInfo._coreNumbers = coreNumbers;

        const result = nvidiaGpuMonitor.getGpuStatistic();

        assert.isArray(result);
        assert.lengthOf(result, 2);
        assert.includeDeepMembers(result, [expectedCoreStat1, expectedCoreStat2]);
        for (let index = 0; index < coreNumbers.length; index++) {
            assert.hasAllKeys(result[index], ['core', 'mem', 'usage']);
            assert.nestedProperty(result[index], 'mem.free');
            assert.nestedProperty(result[index], 'usage.enc');
            assert.nestedProperty(result[index], 'usage.dec');
            assert.isNumber(result[index].mem.free);
            assert.isNumber(result[index].usage.enc);
            assert.isNumber(result[index].usage.dec);
        }
    });

    it('getGpuDriverVersion() returns GPU driver version', () => {
        nvidiaGpuMonitor._status = NvidiaGpuMonitor.STATUS_STARTED;
        nvidiaGpuMonitor._nvidiaGpuInfo._driverVersion = gpuDriverVersion;
        const getDriverVersionSpy = sinon.spy(nvidiaGpuMonitor._nvidiaGpuInfo, 'getDriverVersion');

        const result = nvidiaGpuMonitor.getGpuDriverVersion();

        assert.isTrue(getDriverVersionSpy.calledOnce);
        assert.isTrue(getDriverVersionSpy.calledWithExactly());
        assert.strictEqual(result, gpuDriverVersion);
    });

    it('getGpuProductName() returns GPU driver version', () => {
        nvidiaGpuMonitor._status = NvidiaGpuMonitor.STATUS_STARTED;
        nvidiaGpuMonitor._nvidiaGpuInfo._productNames = gpuProductName;
        const getProductNameSpy = sinon.spy(nvidiaGpuMonitor._nvidiaGpuInfo, 'getProductNames');

        const result = nvidiaGpuMonitor.getGpuProductsName();

        assert.isTrue(getProductNameSpy.calledOnce);
        assert.isTrue(getProductNameSpy.calledWithExactly());
        assert.deepEqual(result, gpuProductName);
    });

    it('_isMemOverloadedByFixedThreshold() return false if enough free mem on each GPU core', () => {
        const minFreeMem = 1;
        const isMemOverloadedByIncorrectDataSpy = sinon.spy(nvidiaGpuMonitor, '_isMemOverloadedByIncorrectData');

        const result = nvidiaGpuMonitor._isMemOverloadedByFixedThreshold(minFreeMem, gpuCoresMem);

        assert.strictEqual(isMemOverloadedByIncorrectDataSpy.callCount, Object.keys(gpuCoresMem).length);
        assert.strictEqual(result, false);
    });

    it('_isMemOverloadedByFixedThreshold() return true if not enough free mem on some GPU core', () => {
        const minFreeMem = 6;
        const result = nvidiaGpuMonitor._isMemOverloadedByFixedThreshold(minFreeMem, gpuCoresMem);

        assert.strictEqual(result, true);
    });

    it('_isMemOverloadedByRateThreshold() return false if enough free mem on each GPU core', () => {
        const highWatermark = 0.9;
        const isMemOverloadedByIncorrectDataSpy = sinon.spy(nvidiaGpuMonitor, '_isMemOverloadedByIncorrectData');

        const result = nvidiaGpuMonitor._isMemOverloadedByRateThreshold(highWatermark, gpuCoresMem);

        assert.strictEqual(isMemOverloadedByIncorrectDataSpy.callCount, Object.keys(gpuCoresMem).length);
        assert.strictEqual(result, false);
    });

    it('_isMemOverloadedByRateThreshold() return true if not enough free mem on some GPU core', () => {
        const highWatermark = 0.4;
        const result = nvidiaGpuMonitor._isMemOverloadedByRateThreshold(highWatermark, gpuCoresMem);

        assert.strictEqual(result, true);
    });

    it('_isGpuUsageOverloadByRateThreshold() return false if enough free mem on each GPU core', () => {
        const highWatermark = 0.9;
        const gpuUsage = {
            '0': 60,
            '1': 75
        };
        const result = nvidiaGpuMonitor._isGpuUsageOverloadByRateThreshold(highWatermark, gpuUsage);

        assert.strictEqual(result, false);
    });

    it('_isGpuUsageOverloadByRateThreshold() return true if not enough free mem on some GPU core', () => {
        const highWatermark = 0.4;
        const gpuUsage = {
            '0': 60,
            '1': 75
        };
        const result = nvidiaGpuMonitor._isGpuUsageOverloadByRateThreshold(highWatermark, gpuUsage);

        assert.strictEqual(result, true);
    });
});
