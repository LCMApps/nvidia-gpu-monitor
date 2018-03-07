'use strict';

const fs = require('fs');
const sinon = require('sinon');
const assert = require('chai').assert;

const NvidiaGpuMonitor = require('../index');

const coresMetaInfo = fs.readFileSync('./tests/coresMetaInfo.txt', 'utf8');
const coresStat = fs.readFileSync('./tests/coresStat.txt', 'utf8');

describe('NvidiaGpuMonitor', () => {
    let monitorConf = {
        nvidiaSmiPath: '/usr/bin/nvidia-sma',
        gpuStatPath: './tests/coresStat.txt',
        checkInterval: 15000,
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

    const expectedSchedulerClass = 'Timeout';

    let nvidiaGpuMonitor;

    beforeEach(() => {
        nvidiaGpuMonitor = new NvidiaGpuMonitor(monitorConf);
    });

    it('start successfully', async () => {
        const determineCoresStatisticStub = sinon.stub(nvidiaGpuMonitor, '_determineCoresStatistic');
        const parseGpuMetaDataStub = sinon.stub(nvidiaGpuMonitor._nvidiaGpuInfo, 'parseGpuMetaData');

        await nvidiaGpuMonitor.start();

        const actualSchedulerClass = nvidiaGpuMonitor._monitorScheduler.constructor.name;

        assert.equal(nvidiaGpuMonitor._status, NvidiaGpuMonitor.STATUS_STARTED);
        assert.isTrue(determineCoresStatisticStub.calledOnce);
        assert.isTrue(determineCoresStatisticStub.calledWithExactly());
        assert.isTrue(parseGpuMetaDataStub.calledOnce);
        assert.isTrue(parseGpuMetaDataStub.calledWithExactly());
        assert.equal(actualSchedulerClass, expectedSchedulerClass);
        assert.equal(nvidiaGpuMonitor._monitorScheduler._repeat, monitorConf.checkInterval);
    });

    it('second start call throws error', async () => {
        const determineCoresStatisticStub = sinon.stub(nvidiaGpuMonitor, '_determineCoresStatistic');
        const parseGpuMetaDataStub = sinon.stub(nvidiaGpuMonitor._nvidiaGpuInfo, 'parseGpuMetaData');

        await nvidiaGpuMonitor.start();

        try {
            await nvidiaGpuMonitor.start();
            assert.fail('service second start success', 'service second start throw error');
        } catch (err) {
            const actualSchedulerClass = nvidiaGpuMonitor._monitorScheduler.constructor.name;

            assert.instanceOf(err, Error);
            assert.equal(err.message, 'NvidiaGpuMonitor service is already started');
            assert.equal(nvidiaGpuMonitor._status, NvidiaGpuMonitor.STATUS_STARTED);
            assert.isTrue(determineCoresStatisticStub.calledOnce);
            assert.isTrue(determineCoresStatisticStub.calledWithExactly());
            assert.isTrue(parseGpuMetaDataStub.calledOnce);
            assert.isTrue(parseGpuMetaDataStub.calledWithExactly());
            assert.equal(actualSchedulerClass, expectedSchedulerClass);
        }
    });

    it('stop scheduler', async () => {
        const determineCoresStatisticStub = sinon.stub(nvidiaGpuMonitor, '_determineCoresStatistic');
        const parseGpuMetaDataStub = sinon.stub(nvidiaGpuMonitor._nvidiaGpuInfo, 'parseGpuMetaData');

        await nvidiaGpuMonitor.start();
        nvidiaGpuMonitor.stop();

        assert.isTrue(determineCoresStatisticStub.calledOnce);
        assert.isTrue(determineCoresStatisticStub.calledWithExactly());
        assert.isTrue(parseGpuMetaDataStub.calledOnce);
        assert.isTrue(parseGpuMetaDataStub.calledWithExactly());
        assert.equal(nvidiaGpuMonitor._status, NvidiaGpuMonitor.STATUS_STOPPED);
        assert.equal(nvidiaGpuMonitor._monitorScheduler._repeat, null);
    });

    it('second stop call throw error', async () => {
        const determineCoresStatisticStub = sinon.stub(nvidiaGpuMonitor, '_determineCoresStatistic');
        const parseGpuMetaDataStub = sinon.stub(nvidiaGpuMonitor._nvidiaGpuInfo, 'parseGpuMetaData');

        await nvidiaGpuMonitor.start();
        nvidiaGpuMonitor.stop();

        assert.throws(() => {
            nvidiaGpuMonitor.stop();
        }, 'NvidiaGpuMonitor service is not started');

        assert.isTrue(determineCoresStatisticStub.calledOnce);
        assert.isTrue(determineCoresStatisticStub.calledWithExactly());
        assert.isTrue(parseGpuMetaDataStub.calledOnce);
        assert.isTrue(parseGpuMetaDataStub.calledWithExactly());
        assert.equal(nvidiaGpuMonitor._status, NvidiaGpuMonitor.STATUS_STOPPED);
        assert.equal(nvidiaGpuMonitor._monitorScheduler._repeat, null);
    });


});
