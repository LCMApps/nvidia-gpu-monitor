'use strict';

const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const assert = require('chai').assert;

const NvidiaGpuInfo = require('../../src/NvidiaGpuInfo');

const coresMetaInfoOutput = fs.readFileSync(path.resolve(__dirname, 'data/gpuMetaInfo.txt'), 'utf8');

describe('NvidiaGpuInfo methods tests', () => {
    let nvidiaSmiPath = '/usr/bin/nvidia-sma';
    let nvidiaGpuInfo;

    beforeEach(() => {
        nvidiaGpuInfo = new NvidiaGpuInfo(nvidiaSmiPath);
    });

    it('parseGpuMetaData() scrapes info about GPU from nvidia-smi output', async () => {
        const expectedDriverVersion = '384.111';
        const expectedProductsName = {
            0: 'Tesla M60',
            1: 'Tesla M61'
        };
        const expectedTotalMem = {
            0: 8129,
            1: 8000
        };
        const expectedCoresNumber = [0, 1];

        const readCoresMetaDataStub = sinon.stub(nvidiaGpuInfo, '_readCoresMetaData');
        readCoresMetaDataStub.returns(Promise.resolve(coresMetaInfoOutput));

        await nvidiaGpuInfo.parseGpuMetaData();

        assert.isTrue(readCoresMetaDataStub.calledOnce);
        assert.isTrue(readCoresMetaDataStub.calledWithExactly());
        assert.deepEqual(nvidiaGpuInfo.getCoreNumbers(), expectedCoresNumber);
        assert.deepEqual(nvidiaGpuInfo.getProductNames(), expectedProductsName);
        assert.strictEqual(nvidiaGpuInfo.getDriverVersion(), expectedDriverVersion);
        for (const coreNumber of expectedCoresNumber) {
            assert.strictEqual(nvidiaGpuInfo.getTotalMemory(coreNumber), expectedTotalMem[coreNumber]);
        }
    });

    it('parseGpuMetaData() throws error', async () => {
        const expectedError = new Error('Some Error');
        const expectedProductsName = {};
        const expectedDriverVersion = undefined;
        const expectedTotalMem = {};
        const expectedCoresNumber = [];

        const readCoresMetaDataStub = sinon.stub(nvidiaGpuInfo, '_readCoresMetaData');
        readCoresMetaDataStub.returns(Promise.reject(expectedError));

        try {
            await nvidiaGpuInfo.parseGpuMetaData();
            assert.isTrue(false, 'Expected to detect error');
        } catch (err) {
            assert.instanceOf(err, Error);
            assert.equal(err.message, expectedError.message);
            assert.isTrue(readCoresMetaDataStub.calledOnce);
            assert.isTrue(readCoresMetaDataStub.calledWithExactly());
            assert.deepEqual(nvidiaGpuInfo.getCoreNumbers(), expectedCoresNumber);
            assert.deepEqual(nvidiaGpuInfo.getProductNames(), expectedProductsName);
            assert.strictEqual(nvidiaGpuInfo.getDriverVersion(), expectedDriverVersion);
            assert.deepEqual(nvidiaGpuInfo._totalMemory, expectedTotalMem);
        }
    });

    it('parseGpuMetaData() don`t run while previous call not finished', () => {
        const readCoresMetaDataStub = sinon.stub(nvidiaGpuInfo, '_readCoresMetaData');
        readCoresMetaDataStub.callsFake(function () {
            return new Promise(resolve => {
                setTimeout(() => resolve(coresMetaInfoOutput), 500);
            });
        });

        nvidiaGpuInfo.parseGpuMetaData();
        nvidiaGpuInfo.parseGpuMetaData();

        assert.isTrue(readCoresMetaDataStub.calledOnce);
        assert.isTrue(readCoresMetaDataStub.calledWithExactly());
    });
});
