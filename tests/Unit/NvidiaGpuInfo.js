'use strict';

const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const assert = require('chai').assert;

const NvidiaGpuInfo = require('../../lib/NvidiaGpuInfo');

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
            '00000000:06:00.0': 'Tesla M60',
            '00000000:07:00.0': 'Tesla M61'
        };
        const expectedPciId2CoreNumber = {
            '00000000:06:00.0': '0',
            '00000000:07:00.0': '1'
        };

        const readCoresMetaDataStub = sinon.stub(nvidiaGpuInfo, '_readCoresMetaData');
        readCoresMetaDataStub.returns(Promise.resolve(coresMetaInfoOutput));

        await nvidiaGpuInfo.parseGpuMetaData();

        assert.isTrue(readCoresMetaDataStub.calledOnce);
        assert.isTrue(readCoresMetaDataStub.calledWithExactly());
        assert.deepEqual(nvidiaGpuInfo._pciId2CoreNumber, expectedPciId2CoreNumber);
        assert.deepEqual(nvidiaGpuInfo._productNames, expectedProductsName);
        assert.strictEqual(nvidiaGpuInfo._driverVersion, expectedDriverVersion);
    });


    it('parseGpuMetaData() throws error', async () => {
        const expectedError = new Error('Some Error');
        const expectedProductName = {};
        const expectedDriverVersion = undefined;
        const expectedPciId2CoreNumber = {};

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
            assert.deepEqual(nvidiaGpuInfo._pciId2CoreNumber, expectedPciId2CoreNumber);
            assert.deepEqual(nvidiaGpuInfo._productNames, expectedProductName);
            assert.deepEqual(nvidiaGpuInfo._driverVersion, expectedDriverVersion);
        }
    });
});
