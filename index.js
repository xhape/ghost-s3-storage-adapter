'use strict';

// # S3 storage module for Ghost blog http://ghost.org/
var fs = require('fs');
var path = require('path');
var Bluebird = require('bluebird');
var AWS = require('aws-sdk-promise');
var moment = require('moment');
var util = require('util');
var readFileAsync = Bluebird.promisify(fs.readFile);
var BaseStore = require('ghost/core/server/storage/base');
var options = {};

function S3Store(config) {
    BaseStore.call(this);
    options = config;
}

util.inherits(S3Store, BaseStore);

 /**
 * Return the URL where image assets can be read.
 * @param  {String} bucket [AWS S3 bucket name]
 * @return {String}        [path-style URL of the S3 bucket]
 */
function getAwsPath(bucket) {
    var awsRegion = (options.region == 'us-east-1') ? 's3' : 's3-' + options.region;
    var awsPath = options.assetHost ? options.assetHost : 'https://' + awsRegion + '.amazonaws.com/' + options.bucket + '/';
    return awsPath;
}

function logError(error) {
    console.log('error in ghost-s3', error);
}

function logInfo(info) {
    console.log('info in ghost-s3', info);
}

function validOptions(opts) {
    return (opts.accessKeyId &&
        opts.secretAccessKey &&
        opts.bucket &&
        opts.region);
}

S3Store.prototype.getTargetName = function(file) {
    var ext = path.extname(file.name);
    var name = path.basename(file.name, ext).replace(/\W/g, '_');

    return path.join(this.getTargetDir(), name + '-' + Date.now() + ext);
};

S3Store.prototype.save = function(image) {
    if (!validOptions(options)) {
      return Bluebird.reject('ghost-s3 is not configured');
    }

    var targetFilename = this.getTargetName(image);

    var s3 = new AWS.S3({
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        bucket: options.bucket,
        region: options.region
    });

    return readFileAsync(image.path)
        .then(function(buffer) {
            var params = {
                ACL: 'public-read',
                Bucket: options.bucket,
                Key: targetFilename,
                Body: buffer,
                ContentType: image.type,
                CacheControl: 'max-age=' + (1000 * 365 * 24 * 60 * 60) // 365 days
            };

            return s3.putObject(params).promise();
        })
        .tap(function() {
            logInfo('ghost-s3', 'Temp uploaded file path: ' + image.path);
        })
        .then(function(results) {
            var awsPath = getAwsPath(options.bucket);
            return Bluebird.resolve(awsPath + targetFilename);
        })
        .catch(function(err) {
            logError(err);
            throw err;
        });
};

// middleware for serving the files
S3Store.prototype.serve = function() {
    var s3 = new AWS.S3({
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        bucket: options.bucket,
        region: options.region
    });

    return function (req, res, next) {
        var params = {
            Bucket: options.bucket,
            Key: req.path.replace(/^\//, '')
        };

        s3.getObject(params)
            .on('httpHeaders', function(statusCode, headers, response) {
                res.set(headers);
            })
            .createReadStream()
            .on('error', function(err) {
                logError(err);
                res.status(404);
                next();
            })
            .pipe(res);
    };
};

S3Store.prototype.delete = function() {

};

S3Store.prototype.exists = function() {

};

module.exports = S3Store;
