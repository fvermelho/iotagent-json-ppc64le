'use strict';

var periodicity = {};
var lastSeen = {};
var timeoutObjs = {};
var deviceStates = {};
var enabledDevices = {};

var sampleQueueMaxSize = undefined;
var waitMultiplier = undefined;
var minimumTimeoutBase = undefined;
var changeDeviceStateCallback = undefined;

var config = require('./configService');

function refreshDevice(device) {
    var deviceId = device.id;
    if (deviceId in enabledDevices) {
        if (enabledDevices[deviceId] == false) {
            // Update only when this device was last seen.
            lastSeen[deviceId] = new Date().getTime(); 
            return;
        }
    }

    var deviceData = undefined;
    if ((device.internalAttributes == undefined) || (device.internalAttributes.timeout == undefined)) {
        deviceData = {
            "sampleQueueMaxSize" : sampleQueueMaxSize,
            "waitMultiplier" : waitMultiplier,
            "minimumTimeoutBase": minimumTimeoutBase
        }
    } else {
        deviceData = device.internalAttributes.timeout;
    }


    if ('periodicity' in deviceData) {
        // If the device has already a known message period, then there is no need to
        // check average arrival time and other things.
        changeDeviceState(device, exports.ONLINE);
        startWatchdog(device, deviceData);
    } else if (deviceId in periodicity) {
        var now = new Date().getTime();
        // In order to decrease the number of internal nodejs timeouts,
        // we set the resolution of the time difference to 'minimumTimeoutBase'
        var timediff = Math.ceil((now - lastSeen[deviceId]) / deviceData.minimumTimeoutBase);
        lastSeen[deviceId] = now;

        periodicity[deviceId].push(timediff);

        if (periodicity[deviceId].length > deviceData.sampleQueueMaxSize) {
            // Pops oldest timestamp
            periodicity[deviceId].shift();
            changeDeviceState(device, exports.ONLINE);
        } else {
            changeDeviceState(device, exports.WARMUP);
        }

        if (periodicity[deviceId].length == deviceData.sampleQueueMaxSize) {
            startWatchdog(device, deviceData);
        }
    } else {
        // Message to yet unknown device.
        if (!(deviceId in enabledDevices)) {
            // Start with disabled state
            enabledDevices[deviceId] = false;
        }
        periodicity[deviceId] = [];
        lastSeen[deviceId] = new Date().getTime();
    }
}

function changeDeviceState(device, state) {
    var deviceId = device.id;
    if (deviceId in deviceStates) {
        if (deviceStates[deviceId] != state) {
            deviceStates[deviceId] = state;
            changeDeviceStateCallback(device, state);
        }
    } else {
        deviceStates[deviceId] = state;
        changeDeviceStateCallback(device, state);
    }
}

function computeAverage(deviceId) {
    if (!(deviceId in periodicity)) {
        return 0;
    }
    var currValue = 0.0;
    for (var i = 0; i < periodicity[deviceId].length; i++) {
        currValue += periodicity[deviceId][i];
    }
    return currValue / periodicity[deviceId].length;
}

function startWatchdog(device, deviceData) {
    if (device.id in timeoutObjs) {
        clearTimeout(timeoutObjs[device.id]);
    }

    var timeToWait = 0;
    if ('periodicity' in deviceData) {
        timeToWait = deviceData.periodicity * deviceData.waitMultiplier;
    } else {
        var average = computeAverage(device.id);
        // Optmization for nodejs
        timeToWait = deviceData.waitMultiplier*average*deviceData.minimumTimeoutBase;
    }
    timeoutObjs[device.id] = setTimeout(changeDeviceState, timeToWait, device, exports.OFFLINE);
}

function setDeviceEnabled(device, state) {
    enabledDevices[device.id] = state;
    if (state == false) {
        changeDeviceState(device, exports.DISABLED);
    }
}

function addDevice(device) {
    // In case of empty internal attribute...
    // Dead code.
    if (device.internalAttributes == undefined) {
        device.internalAttributes = {"timeout" : {}};
    } else if (!('timeout' in device.internalAttributes)) {
        device.internalAttributes.timeout = {};
    }

    if (!('periodicity' in device.internalAttributes.timeout)) {
        if (!('sampleQueueMaxSize' in device.internalAttributes.timeout)) {
            device.internalAttributes.timeout.sampleQueueMaxSize = sampleQueueMaxSize;
        }

        if (!('minimumTimeoutBase' in device.internalAttributes.timeout)) {
            device.internalAttributes.timeout.minimumTimeoutBase = minimumTimeoutBase;
        }
    }
    if (!('waitMultiplier' in device.internalAttributes.timeout)) { 
        device.internalAttributes.timeout.waitMultiplier = waitMultiplier;
    }

    setDeviceEnabled(device, true);
}


function removeDevice(device) {
    // Cancel any pending timeout
    if (device.id in timeoutObjs) {
        clearTimeout(timeoutObjs[device.id]);
        delete timeoutObjs[device.id];
    }

    if (device.id in lastSeen) {
        delete lastSeen[device.id];
    }
    if (device.id in periodicity) {
        delete periodicity[device.id];
    }
    if (device.id in deviceStates) {
        delete deviceStates[device.id];
    }
    if (device.id in enabledDevices) {
        delete enabledDevices[device.id];
    }
}

function setChangeDeviceStateCallback(f) {
    // >> Sanity checks
    // << Sanity checks
    changeDeviceStateCallback = f;
}

function setWaitMultiplier(multiplier) {
    // >> Sanity checks
    // << Sanity checks
    waitMultiplier = multiplier;
}

function setSampleQueueMaxSize(queueSize) {
    // >> Sanity checks
    // << Sanity checks
    sampleQueueMaxSize = queueSize;
}

function setMinimumTimeoutBase(base) {
    // >> Sanity checks
    // << Sanity checks
    minimumTimeoutBase = base;
}

function start() {
    waitMultiplier = config.getConfig().timeout.waitMultiplier;
    sampleQueueMaxSize = config.getConfig().timeout.sampleQueueMaxSize;
    minimumTimeoutBase = config.getConfig().timeout.minimumTimeoutBase;
}


exports.start = start;
exports.refreshDevice = refreshDevice;
exports.setDeviceEnabled = setDeviceEnabled;
exports.removeDevice = removeDevice;
exports.addDevice = addDevice;
exports.setChangeDeviceStateCallback = setChangeDeviceStateCallback;
exports.setWaitMultiplier = setWaitMultiplier;
exports.setSampleQueueMaxSize = setSampleQueueMaxSize;
exports.setMinimumTimeoutBase = setMinimumTimeoutBase;
exports.ONLINE = "online";
exports.OFFLINE = "offline";
exports.WARMUP = "warm-up";
exports.DISABLED = "disabled";
