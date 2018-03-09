'use strict';

const fs = require('fs');
const sinon = require('sinon');
const assert = require('chai').assert;

const NvidiaGpuInfo = require('../lib/NvidiaGpuInfo');

const coresMetaInfoOutput = fs.readFileSync('./tests/coresMetaInfo.txt', 'utf8');

describe('NvidiaGpuInfo methods tests', () => {
    let nvidiaSmiPath = '/usr/bin/nvidia-sma';
    let nvidiaGpuInfo;

    beforeEach(() => {
        nvidiaGpuInfo = new NvidiaGpuInfo(nvidiaSmiPath);
    });

    it('parseGpuMetaData() scrapes info about GPU from nvidia-smi output', async () => {
        const expectedProductName = 'Tesla M60';
        const expectedDriverVersion = '384.111';
        const expectedCoresId2NumberHash = {
            '00000000:06:00.0': '0',
            '00000000:07:00.0': '1'
        };

        const readCoresMetaDataStub = sinon.stub(nvidiaGpuInfo, '_readCoresMetaData');
        readCoresMetaDataStub.returns(Promise.resolve(coresMetaInfoOutput));

        await nvidiaGpuInfo.parseGpuMetaData();

        assert.isTrue(readCoresMetaDataStub.calledOnce);
        assert.isTrue(readCoresMetaDataStub.calledWithExactly());
        assert.deepEqual(nvidiaGpuInfo._coresId2NumberHash, expectedCoresId2NumberHash);
        assert.deepEqual(nvidiaGpuInfo._productName, expectedProductName);
        assert.deepEqual(nvidiaGpuInfo._driverVersion, expectedDriverVersion);
    });


    it('parseGpuMetaData() throws error', async () => {
        const expectedError = new Error('Some Error');
        const expectedProductName = '';
        const expectedDriverVersion = '';
        const expectedCoresId2NumberHash = {};

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
            assert.deepEqual(nvidiaGpuInfo._coresId2NumberHash, expectedCoresId2NumberHash);
            assert.deepEqual(nvidiaGpuInfo._productName, expectedProductName);
            assert.deepEqual(nvidiaGpuInfo._driverVersion, expectedDriverVersion);
        }
    });
});
