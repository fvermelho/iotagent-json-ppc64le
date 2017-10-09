'use strict';

var config = require('../configService');

/**
 * Translate proprietary format to iot-agent format
 */
function translate(original, topics) {
    var translated = {};
    var attributeName = "";
    for(var i = 0; i < original.data.length; i++) {
        var key = original.data[i].key;
        var value = original.data[i].value;
        translated[key] = value;
    }
    return [translated, undefined];
};

exports.translate = translate;
exports.resourceType = 'SensorWebDevice';
