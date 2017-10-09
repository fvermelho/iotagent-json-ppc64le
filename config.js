/*
 * Copyright 2015 Telefonica Investigación y Desarrollo, S.A.U
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
var config = {};

config.mqtt = {
    host: 'mosquitto',
    port: 1883,
    defaultKey: '1234',
    thinkingThingsPlugin: true,
    protocolId: 'MQIsdp',
    protocolVersion: 3,
    secure: false,
    tls: {
        key: 'client-key.pem',
        cert: 'client-cert.pem',
        ca: [ 'server-cert.pem' ],
        version: 'TLSv1_2_method' // If empty, TLS version is automatic
    }
};

config.iota = {
    logLevel: 'DEBUG',
    timestamp: true,
    contextBroker: {
        host: 'orion',
        port: '1026'
    },
    server: {
        port: 4041
    },
    deviceRegistry: {
        type: 'mongodb'
    },
    mongodb: {
        host: 'mongodb',
        port: '27017',
        db: 'iotagentjson'
    },
    types: {},
    service: 'howtoService',
    subservice: '/howto',
    providerUrl: 'http://localhost:4041',
    deviceRegistrationDuration: 'P1M',
    defaultType: 'Thing'
};

config.timeout = {
    /** Number of messages skipped before declaring a device as offline */
    waitMultiplier: 3,
    /** Number of messages to calculate average message arrival time */
    sampleQueueMaxSize: 10,
    /** Timeout resolution and minimum timeout - in miliseconds.*/
    minimumTimeoutBase: 50
}

config.configRetrieval = false;

module.exports = config;
