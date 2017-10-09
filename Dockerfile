###
# Copyright (c) Mainflux
#
# This file is part of iotagent-json and is published under GNU Affero General Public License
# See the included LICENSE file for more details.
###

FROM ppc64le/node:6.11.3

MAINTAINER Daniel Moran Jimenez <daniel.moranjimenez@telefonica.com>

ARG NODEJS_VERSION=

COPY . /opt/iotajson/
WORKDIR /opt/iotajson

RUN npm install --production

ENTRYPOINT bin/iotagent-json config.js
EXPOSE 4041
