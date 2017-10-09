/*
 * Copyright 2016 Telefonica Investigación y Desarrollo, S.A.U
 *
 * This file is part of iotagent-json
 *
 * iotagent-json is free software: you can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the License,
 * or (at your option) any later version.
 *
 * iotagent-json is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public
 * License along with iotagent-json.
 * If not, seehttp://www.gnu.org/licenses/.
 *
 * For those usages not covered by the GNU Affero General Public License
 * please contact with::[contacto@tid.es]
 */

'use strict';

var path = require('path'),
    fs = require('fs'),
    iotAgentLib = require('iotagent-node-lib'),
    mqtt = require('mqtt'),
    commonBindings = require('../commonBindings'),
    commandHandler = require('../commandHandler'),
    async = require('async'),
    iotaUtils = require('../iotaUtils'),
    constants = require('../constants'),
    context = {
        op: 'IoTAgentJSON.MQTTBinding'
    },
    mqttClient,
    config = require('../configService'),
    translatorBindings = [],
    registeredTopics = [],
    timeout = require('../timeouts');

/**
 * Return if two topics match with each other.
 * This function considers that these two MQTT topics are valid.
 *
 * @param {Array} templateTopic The template to be checked (possibly with wildcards)
 * @param {Array} receivedTopic The topic to be checked against the template
 */
function areMatchingTopics(templateTopic, receivedTopic) {
    var ret = true;

    for (var i = 0, j = 0; i < templateTopic.length, j < receivedTopic.length; i++, j++) {
        if (templateTopic === '#') {
            // This is a multi-level wildcard. No need to keep checking.
            return ret;
        }
        ret &= ((templateTopic === '+') || (templateTopic === receivedTopic));
        if (ret == false) {
            // No need to keep checking
            break;
        }
    }

    return ret;
}

/**
 * Translate a proprietary message to iot-agent format.
 * It is expected that the translators located in 'translators' folder
 * should do this task. They are also supposed to identify whether this
 * is a single-variable message (the translator need to return the variable
 * name in this case) or if it is a multi-variable message, in which case
 * it will only build a map whose keys are variable names and values, well,
 * the received values.
 * If there is no compatible translator, then the message will be used as-is.
 * @param {String} type The device type to be checked
 * @param {Array} topicInformation The list of tokens from the received message's topic
 * @param {Object} parsedMessage The received message already parsed.
 * @returns {Array} First element will be the converted message, second one should be
 * the variable name if this is a single-variable message.
 */
function translateMessage(type, topicInformation, parsedMessage) {
    var hasMatchingType = false;
    var translatedParsedMessage = {};
    var attributeName = undefined;

    // Checking translator
    for (var i = 0; i < translatorBindings.length; i++) {
        if (translatorBindings[i].resourceType === type) {
            [translatedParsedMessage, attributeName] = translatorBindings[i].translate(parsedMessage, topicInformation);
            hasMatchingType = true;
            break;
        }
    }

    if (hasMatchingType == false) {
        config.getLogger().debug(context, 'Using message as-is (no translator was found)');
        translatedParsedMessage = parsedMessage;
    }

    return [translatedParsedMessage, attributeName];
}

/**
 * Update the device attribute if necessary.
 * If there is a new attribute that was not originally configured in the CB
 * then this function will update it.
 */
function updateRegisterIfNecessary(values, device) {
  // Checking if incoming data has new attributes
  var shouldUpdate = false;
  var newValues = [];
  for (var i = 0; i < values.length; i++) {
    if (device.active.find(function (param) { return values[i].name === param.object_id; }) == undefined) {
      var newAttr = Object.assign({}, values[i]);
      newValues.push(newAttr)
    }
  }
  if (newValues.length != 0) {
    var newDevice = Object.assign({}, device);
    newDevice.active = newDevice.active.concat(newValues);
    iotAgentLib.updateRegister(newDevice);
  }
}

/**
 * Register device translation units
 */

function registerDeviceTranslators() {
    var translators = fs.readdirSync(path.join(__dirname, '../translators'));
    translatorBindings = translators.map(function(item) {
        return require('../translators/' + item);
    });
};

/**
 * Adds a single MQTT measure to the context broker. The message for single measures contains the direct value to
 * be inserted in the attribute, given by its name.
 *
 * @param {String} apiKey           API Key corresponding to the Devices configuration.
 * @param {String} deviceId         Id of the device to be updated.
 * @param {String} attribute        Name of the attribute to update.
 * @param {Object} device           Device object containing all the information about a device.
 * @param {Buffer} message          Raw message coming from the MQTT client.
 */
function singleMeasure(apiKey, deviceId, attribute, device, message) {
    var values;

    config.getLogger().debug(context, 'Processing single measure for device [%s] with apiKey [%s]', deviceId, apiKey);

    values = [
        {
            name: attribute,
            type: commonBindings.guessType(attribute, device),
            value: message.toString()
        }
    ];

    updateRegisterIfNecessary(values, device)

    iotAgentLib.update(device.name, device.type, '', values, device, function(error) {
        if (error) {
            config.getLogger().error(context,
                'MEASURES-002: Couldn\'t send the updated values to the Context Broker due to an error: %s', error);
        } else {
            config.getLogger().debug(context, 'Single measure for device [%s] with apiKey [%s] successfully updated',
                deviceId, apiKey);
        }
    });
}

/**
 * Adds a device status update to the context broker.
 *
 * @param {String} deviceId         Id of the device to be updated.
 * @param {Object} device           Device object containing all the information about a device.
 * @param {strign} status           New device status
 */
function updateDeviceStatus(deviceId, device, status) {
    config.getLogger().debug(context, 'Processing device status update for device [%s]', deviceId);

    var values = [
        {
            name: "device-status",
            type: "string",
            value: status
        }
    ];

    updateRegisterIfNecessary(values, device)

    iotAgentLib.update(device.name, device.type, '', values, device, function(error) {
        if (error) {
            config.getLogger().error(context,
                'MEASURES-002: Couldn\'t send the updated values to the Context Broker due to an error: %s', error);
        } else {
            config.getLogger().debug(context, 'Device status for device [%s] successfully updated',
                deviceId);
        }
    });
}

/**
 * Adds multiple MQTT measures to the Context Broker. Multiple measures come in the form of single-level JSON objects,
 * whose keys are the attribute names and whose values are the attribute values.
 *
 * @param {String} apiKey           API Key corresponding to the Devices configuration.
 * @param {String} deviceId         Id of the device to be updated.
 * @param {Object} device           Device object containing all the information about a device.
 * @param {Object} messageObj       JSON object sent using MQTT.
 */
function multipleMeasures(apiKey, deviceId, device, messageObj) {
    config.getLogger().debug(context,
        'Processing multiple measures for device [%s] with apiKey [%s]', deviceId, apiKey);

    var values = commonBindings.extractAttributes(device, messageObj);
    updateRegisterIfNecessary(values, device)

    iotAgentLib.update(device.name, device.type, '', values, device, function(error) {
        if (error) {
            config.getLogger().error(context,
                'MEASURES-002: Couldn\'t send the updated values to the Context Broker due to an error: %s', error);
        } else {
            config.getLogger().debug(context, 'Multiple measures for device [%s] with apiKey [%s] successfully updated',
                deviceId, apiKey);
        }
    });
}

/**
 * Generate the list of global topics to listen to.
 */
function generateTopics(callback) {
    var topics = [];

    config.getLogger().debug(context, 'Generating topics');
    topics.push('/+/+/' + constants.MEASURES_SUFIX + '/+');
    topics.push('/+/+/' + constants.MEASURES_SUFIX);
    topics.push('/+/+/' + constants.CONFIGURATION_SUFIX + '/' + constants.CONFIGURATION_COMMAND_SUFIX);
    topics.push('/+/+/' + constants.CONFIGURATION_COMMAND_UPDATE);

    callback(null, topics);
}

/**
 * Parse a message received from a MQTT Topic.
 *
 * @param {Buffer} message          Message to be parsed
 * @return {Object}                 Parsed message or null if an error has occurred.
 */
function parseMessage(message) {
    var parsedMessage,
        stringMessage;

    try {
        stringMessage = message.toString();
        parsedMessage = JSON.parse(stringMessage);
    } catch (e) {
        config.getLogger().debug(context, 'Parse error treating message [%s]: %j', stringMessage, e);
        parsedMessage = null;
    }

    if (!parsedMessage) {
        config.getLogger().error(context, 'MEASURES-003: Impossible to handle malformed message: %s', message);
    }

    return parsedMessage;
}

/**
 * Subscribe to specific topics
 * @param {Array} topics The topics to subscribe
 */
function subscribeToTopics(topics, callback) {
    config.getLogger().debug(context, 'Subscribing to topics: %j', topics);

    mqttClient.subscribe(topics, null, function(error) {
        if (error) {
            iotAgentLib.alarms.raise(constants.MQTTB_ALARM, error);
            config.getLogger().error(context, 'GLOBAL-001: Error subscribing to topics: %s', error);
            callback(error);
        } else {
            iotAgentLib.alarms.release(constants.MQTTB_ALARM);
            config.getLogger().debug(context, 'Successfully subscribed to the following topics:\n%j\n', topics);
            callback(null);
        }
    });
}

/**
 * Unsubscribe to specific topics
 * @param {Array} topics The topics to unsubscribe
 */
function unsubscribeFromTopics(topics, callback) {
    config.getLogger().debug(context, 'Unsubscribing from topics: %j', topics);
    mqttClient.unsubscribe(topics, function(error) {
        if (error) {
            iotAgentLib.alarms.raise(constants.MQTTB_ALARM, error);
            config.getLogger().error(context, 'GLOBAL-001: Error unsubscribing from topics: %s', error);
            callback(error);
        } else {
            iotAgentLib.alarms.release(constants.MQTTB_ALARM);
            config.getLogger().debug(context, 'Successfully unsubscribed to the following topics:\n%j\n', topics);
            callback(null);
        }
    });
}

/**
 * Recreate the MQTT subscriptions for all the registered devices.
 */
function recreateSubscriptions(callback) {
    config.getLogger().debug(context, 'Recreating subscriptions for all devices');
    var topics = [];
    var total = 0, offset = 0;

    async.waterfall([
        generateTopics,
        subscribeToTopics
    ], callback);

    function listDevicesInternal(error, result) {
        for (var i = 0; i < result.count; i++) {
            deviceNotificationCallback(iotAgentLib.deviceEvents.DEVICE_CREATED, result.devices[i]);
        }

        if (result.count == 100) {
            offset += result.count;
            iotAgentLib.listDevices('', '', 100, offset, listDevicesInternal);
        }
    }
    iotAgentLib.listDevices('', '', 100, 0, listDevicesInternal);
}


/**
 * Extract all the information from a Context Broker response and send it to the topic indicated by the APIKey and
 * DeviceId.
 *
 * @param {String} apiKey           API Key for the Device Group
 * @param {String} deviceId         ID of the Device.
 * @param {Object} results          Context Broker response.
 */
function sendConfigurationToDevice(apiKey, deviceId, results, callback) {
    var configurations = iotaUtils.createConfigurationNotification(results);

    config.getLogger().debug(context, 'Sending requested configuration to the device:\n %j', configurations);

    mqttClient.publish(
        '/' + apiKey + '/' + deviceId + '/' + constants.CONFIGURATION_SUFIX + '/' +
        constants.CONFIGURATION_VALUES_SUFIX,
        JSON.stringify(configurations), null, callback);
}

/**
 * Deals with configuration requests coming from the device. Whenever a new configuration requests arrives with a list
 * of attributes to retrieve, this handler asks the Context Broker for the values of those attributes, and publish a
 * new message in the "/1234/MQTT_2/configuration/values" topic
 *
 * @param {String} apiKey           API Key corresponding to the Devices configuration.
 * @param {String} deviceId         Id of the device to be updated.
 * @param {Object} device           Device object containing all the information about a device.
 * @param {Object} objMessage          JSON object received with MQTT.
 */
function manageConfigurationRequest(apiKey, deviceId, device, objMessage) {
    iotaUtils.manageConfiguration(apiKey, deviceId, device, objMessage, sendConfigurationToDevice, function(error) {
        if (error) {
            iotAgentLib.alarms.raise(constants.MQTTB_ALARM, error);
        } else {
            iotAgentLib.alarms.release(constants.MQTTB_ALARM);
            config.getLogger().debug(
                context, 'Configuration request finished for APIKey [%s] and Device [%s]', apiKey, deviceId);
        }
    });
}

/**
 * Handles an incoming MQTT message, extracting the API Key, device Id and attribute to update (in the case of single
 * measures) from the MQTT topic.
 *
 * -- This has been deprecated --
 *
 * @param {String} topic        Topic of the form: '/<APIKey>/deviceId/attrs[/<attributeName>]'.
 * @param {Object} message      MQTT message body (Object or Buffer, depending on the value).
 */
function mqttMessageHandlerOriginal(topic, message) {
    var topicInformation = topic.split('/'),
        apiKey = topicInformation[1],
        deviceId = topicInformation[2],
        parsedMessage = parseMessage(message);

    function processDeviceMeasure(error, device) {
        if (error) {
            config.getLogger().error(context, 'MEASURES-004: Device not found for topic [%s]', topic);
        } else {
            if (topicInformation[3] === 'configuration' && topicInformation[4] === 'commands' && parsedMessage) {
                manageConfigurationRequest(apiKey, deviceId, device, parsedMessage);
            } else if (topicInformation[4]) {
                singleMeasure(apiKey, deviceId, topicInformation[4], device, message);
            } else if (topicInformation[3] === constants.CONFIGURATION_COMMAND_UPDATE) {
                commandHandler.updateCommand(apiKey, deviceId, device, parsedMessage);
            } else if (parsedMessage && typeof parsedMessage === 'object') {
                multipleMeasures(apiKey, deviceId, device, parsedMessage);
            } else {
                config.getLogger().error(context, 'Couldn\'t process message [%s] due to format issues.', message);
            }
        }
    }

    iotAgentLib.alarms.release(constants.MQTTB_ALARM);
    iotAgentLib.retrieveDevice(deviceId, apiKey, processDeviceMeasure);
}

/**
 * Handles an incoming MQTT message, extracting the API Key, device Id and attribute to update (in the case of single
 * measures) from the MQTT topic.
 *
 * @param {String} topic        Topic of the form: '/<APIKey>/deviceId/attrs[/<attributeName>]'.
 * @param {Object} message      MQTT message body (Object or Buffer, depending on the value).
 */
function mqttMessageHandler(topic, message) {

    var topicInformation = topic.split('/'),
        apiKey = topicInformation[1],
        deviceId = topicInformation[2],
        parsedMessage = parseMessage(message),
        translatedParsedMessage = {},
        attributeName = "";

    function processDeviceMeasure(error, topic_type, device) {
        if (error) {
            config.getLogger().error(context, 'MEASURES-004: Device not found for topic [%s]', topic);
        } else {
            [translatedParsedMessage, attributeName] = translateMessage(device.type, topicInformation, parsedMessage);

            if (topic_type === "attributes") {
                // This is not a configuration message
                if (attributeName == undefined) {
                    multipleMeasures('', device.id, device, translatedParsedMessage);
                } else {
                    singleMeasure('', device.id, attributeName, device, translatedParsedMessage);
                }
            } else if (topic_type === "configuration") {
                // This is a configuration message
                // TODO How to deal with it?
            }

            timeout.refreshDevice(device);
        }
    }
    function processDeviceMeasureFallback(error, device) {
        if (error) {
            config.getLogger().error(context, 'MEASURES-004: Device not found for topic [%s]', topic);
        } else {
            if (topicInformation[3] === 'configuration' && topicInformation[4] === 'commands' && parsedMessage) {
                manageConfigurationRequest(apiKey, deviceId, device, parsedMessage);
            } else if (topicInformation[4]) {
                singleMeasure(apiKey, deviceId, topicInformation[4], device, message);
            } else if (topicInformation[3] === constants.CONFIGURATION_COMMAND_UPDATE) {
                commandHandler.updateCommand(apiKey, deviceId, device, parsedMessage);
            } else if (parsedMessage && typeof parsedMessage === 'object') {
                multipleMeasures(apiKey, deviceId, device, parsedMessage);
            } else {
                config.getLogger().error(context, 'Couldn\'t process message [%s] due to format issues.', message);
            }
            timeout.refreshDevice(device);
        }
    }

    var isFound = false;
    iotAgentLib.alarms.release(constants.MQTTB_ALARM);
    for (var i = 0; i < registeredTopics.length; i++) {
        if (areMatchingTopics(registeredTopics[i].topic, topic) == true) {
            // This is the correct device
            isFound = true;
            processDeviceMeasure(undefined, registeredTopics[i].type, registeredTopics[i].device);
            break;
        }
    }
    if (isFound == false) {
        if ((apiKey.length == 0) || (deviceId.length == 0)) {
          // Nothing to do
          config.getLogger().error(context, 'Couldn\'t process message [%s] due to empty device ID or apikey.', message);
          return;
        }
        // Falling back
        iotAgentLib.retrieveDevice(deviceId, apiKey, processDeviceMeasureFallback);
    }
}

/**
 * Unsubscribe the MQTT Client from all the topics.
 */
function unsubscribeAll(callback) {
    async.waterfall([
        generateTopics,
        unsubscribeFromTopics
    ], callback);
}


/**
 * Callback for device notifications (creation and deletion)
 * @param {iotAgentLib.deviceEvents} event What happened to this device.
 * @param {Object} device The notified device
 */
function deviceNotificationCallback(event, device) {
    function innerCb(error) {
        if (error) {
            config.getLogger().info(context, 'Error during MQTT topic operation: %s', error);
        }
    }

    if (event === iotAgentLib.deviceEvents.DEVICE_CREATED) {
        timeout.addDevice(device);
    } else if (event === iotAgentLib.deviceEvents.DEVICE_REMOVED) {
        timeout.removeDevice(device);
    }


    config.getLogger().info(context, 'Something happened to a device: %s', event);
    if (device.transport !== 'mqtt') {
        return;
    }

    var topicRegistrations = [];

    // The internal_attributes should have MQTT specification
    // This specs should have:
    // - topic: {TRANSPORT_PROTOCOL}:mqtt:{TOPIC}
    // For now we are ignoring transport, assuming tcp.
    var mqtt_specs = device.internalAttributes;
    var topics = [];
    if (mqtt_specs != undefined) {
        if (mqtt_specs.attributes != undefined) {
            if (mqtt_specs.attributes instanceof Array) {
                for (var i = 0; i < mqtt_specs.attributes.length; i++) {
                    topics.push(mqtt_specs.attributes[i].topic.split(':')[2]);
                    var registration = { topic : mqtt_specs.attributes[i].topic.split(':')[2],
                                         type : "attributes",
                                         device: device};
                    topicRegistrations.push(registration);
                }
            } else {
                topics.push(mqtt_specs.attributes.topic.split(':')[2]);
                registration = { topic : mqtt_specs.attributes.topic.split(':')[2],
                                 type : "attributes",
                                 device: device};
                topicRegistrations.push(registration);
            }
        }
        if (mqtt_specs.configuration != undefined) {
            if (mqtt_specs.configuration instanceof Array) {
                for (var i = 0; i < mqtt_specs.configuration.length; i++) {
                    topics.push(mqtt_specs.configuration[i].topic.split(':')[2]);
                    registration = { topic : mqtt_specs.configuration[i].topic.split(':')[2],
                                     type : "configuration",
                                     device_type: device.type,
                                     device: device};
                    topicRegistrations.push(registration);
                }
            } else {
                topics.push(mqtt_specs.configuration.topic.split(':')[2]);
                registration = { topic : mqtt_specs.configuration.topic.split(':')[2],
                                 type : "configuration",
                                 device: device};
                topicRegistrations.push(registration);
            }
        }
    }

    if (topics.length == 0) {
        return;
    }

    if (event === iotAgentLib.deviceEvents.DEVICE_CREATED) {
        for (var i = 0; i < topicRegistrations.length; i++) {
            registeredTopics.push(topicRegistrations[i]);
        }
        subscribeToTopics(topics, innerCb);
    } else if (event === iotAgentLib.deviceEvents.DEVICE_REMOVED) {
        for (var i = 0; i < topicRegistrations.length; i++) {
            for (var j = 0; j < registeredTopics.length; j++) {
                if (topicRegistrations[i].device.id === registeredTopics[j].device.id) {
                    registeredTopics.splice(j, 1);
                    break;
                }
            }
        }
        unsubscribeFromTopics(topics, innerCb);
    }
}

function groupNotificationCallback(event, group) {
    config.getLogger().info(context, 'Something happened to a group: %s', event);
}

/**
 * Start the binding.
 */
function start(callback) {
    registerDeviceTranslators();
    iotAgentLib.addGroupNotificationCallback(groupNotificationCallback);
    iotAgentLib.addDeviceNotificationCallback(deviceNotificationCallback);

    timeout.setChangeDeviceStateCallback(changeDeviceState);

    var options = {
        keepalive: 0,
        connectTimeout: 60 * 60 * 1000
    };

    if (config.getConfig().mqtt.username && config.getConfig().mqtt.password) {
        options.username = config.getConfig().mqtt.username;
        options.password = config.getConfig().mqtt.password;
    }

    let protocol = '';
    if ((config.getConfig().mqtt.secure != undefined) && (config.getConfig().mqtt.secure == true)) {
      // Read TLS configuration
      options.key = fs.readFileSync(config.getConfig().mqtt.tls.key, 'utf8');
      options.cert = fs.readFileSync(config.getConfig().mqtt.tls.cert, 'utf8');
      options.ca = [];
      for (var i = 0; i < config.getConfig().mqtt.tls.ca.length; i++) {
        options.ca.push(fs.readFileSync(config.getConfig().mqtt.tls.ca[i], 'utf8'));
      }
      // This should be removed from here ASAP
      options.passphrase = 'cpqdiot2017';
      options.secureProtocol = config.getConfig().mqtt.tls.version;
      options.port = config.getConfig().mqtt.port;
      options.protocol = 'mqtts';
      options.protocolId = config.getConfig().mqtt.protocolId;
      options.protocolVersion = config.getConfig().mqtt.protocolVersion;

      protocol = 'mqtts://';
    } else {
      protocol = 'mqtt://';
    }

    mqttClient = mqtt.connect(protocol + config.getConfig().mqtt.host + ':' + config.getConfig().mqtt.port, options);


    mqttClient.on('message', mqttMessageHandler);

    mqttClient.on('connect', function() {
        config.getLogger().info(context, 'MQTT Client connected');
        recreateSubscriptions(callback);
    });
}

/**
 * Device provisioning handler.
 *
 * @param {Object} device           Device object containing all the information about the provisioned device.
 */
function deviceProvisioningHandler(device, callback) {
    callback(null, device);
}

/**
 * Stop the binding, releasing its resources.
 */
function stop(callback) {
    async.series([
        unsubscribeAll,
        mqttClient.end.bind(mqttClient, true)
    ], callback);
}

/**
 * Execute a command for the device represented by the device object and the given APIKey, sending the serialized
 * JSON payload (already containing the command information).
 *
 * @param {String} apiKey                   APIKey of the device that will be receiving the command.
 * @param {Object} device                   Data object for the device receiving the command.
 * @param {String} serializedPayload        String payload in JSON format for the command.
 */
function executeCommand(apiKey, device, serializedPayload, callback) {
    mqttClient.publish('/' + apiKey + '/' + device.id + '/cmd', serializedPayload, null);
    callback();
}

function changeDeviceState(device, state) {
    updateDeviceStatus(device.id, device, state);
}


exports.start = start;
exports.stop = stop;

exports.sendConfigurationToDevice = sendConfigurationToDevice;
exports.deviceProvisioningHandler = deviceProvisioningHandler;
exports.executeCommand = executeCommand;
exports.protocol = 'MQTT';
exports.subscribeToTopics = subscribeToTopics;
