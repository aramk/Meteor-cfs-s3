// We use the official aws sdk
AWS = Npm.require('aws-sdk');

var validS3ServiceParamKeys = [
  'endpoint',
  'accessKeyId',
  'secretAccessKey',
  'sessionToken',
  'credentials',
  'credentialProvider',
  'region',
  'maxRetries',
  'maxRedirects',
  'sslEnabled',
  'paramValidation',
  'computeChecksums',
  's3ForcePathStyle',
  'httpOptions',
  'apiVersion',
  'apiVersions',
  'logger',
  'signatureVersion'
];
var validS3PutParamKeys = [
  'ACL',
  'Body',
  'Bucket',
  'CacheControl',
  'ContentDisposition',
  'ContentEncoding',
  'ContentLanguage',
  'ContentLength',
  'ContentMD5',
  'ContentType',
  'Expires',
  'GrantFullControl',
  'GrantRead',
  'GrantReadACP',
  'GrantWriteACP',
  'Key',
  'Metadata',
  'ServerSideEncryption',
  'StorageClass',
  'WebsiteRedirectLocation'
];

/**
 * @public
 * @constructor
 * @param {String} name - The store name
 * @param {Object} options
 * @param {String} options.region - Bucket region
 * @param {String} options.bucket - Bucket name
 * @param {String} [options.accessKeyId] - AWS IAM key; required if not set in environment variables
 * @param {String} [options.secretAccessKey] - AWS IAM secret; required if not set in environment variables
 * @param {String} [options.ACL='private'] - ACL for objects when putting
 * @param {String} [options.folder='/'] - Which folder (key prefix) in the bucket to use
 * @param {Function} [options.beforeSave] - Function to run before saving a file from the server. The context of the function will be the `FS.File` instance we're saving. The function may alter its properties.
 * @param {Function} [options.fileKey] - Function which returns the file key to use for the given `FS.File` and an object containing the file `info` and `name` of the store.
 * @param {Number} [options.maxTries=5] - Max times to attempt saving a file
 * @returns {FS.StorageAdapter} An instance of FS.StorageAdapter.
 *
 * Creates an S3 store instance on the server. Inherits from FS.StorageAdapter
 * type.
 */
FS.Store.S3 = function(name, options) {
  var self = this;
  if (!(self instanceof FS.Store.S3))
    throw new Error('FS.Store.S3 missing keyword "new"');

  options = options || {};

  // Determine which folder (key prefix) in the bucket to use
  var folder = options.folder;
  if (typeof folder === "string" && folder.length) {
    if (folder.slice(0, 1) === "/") {
      folder = folder.slice(1);
    }
    if (folder.slice(-1) !== "/") {
      folder += "/";
    }
  } else {
    folder = "";
  }

  var bucket = options.bucket;
  if (!bucket)
    throw new Error('FS.Store.S3 you must specify the "bucket" option');

  var defaultAcl = options.ACL || 'private';

  // Remove serviceParams from SA options
 // options = _.omit(options, validS3ServiceParamKeys);

  var serviceParams = FS.Utility.extend({
    Bucket: bucket,
    region: null, //required
    accessKeyId: null, //required
    secretAccessKey: null, //required
    ACL: defaultAcl
  }, options);

  // Whitelist serviceParams, else aws-sdk throws an error
  // XXX: I've commented this at the moment... It stopped things from working
  // we have to check up on this
  // serviceParams = _.pick(serviceParams, validS3ServiceParamKeys);

  // Create S3 service
  var S3 = new AWS.S3(serviceParams);

  return new FS.StorageAdapter(name, options, {
    typeName: 'storage.s3',
    fileKey: function(fileObj) {
      // Lookup the copy
      var info = fileObj && fileObj._getInfo(name);
      // If the store and key is found return the key
      if (info && info.key) return info.key;

      var filename = fileObj.name();
      var filenameInStore = fileObj.name({store: name});

      if (options.fileKey) {
        return options.fileKey(fileObj, {
          name: name, info: info
        });
      }

      // If no store key found we resolve / generate a key
      return fileObj.collectionName + '/' + fileObj._id + '-' + (filenameInStore || filename);
    },
    createReadStream: function(fileKey, options) {
      options = _.extend({
        tries: 3,
        tryFreq: 1000
      }, options);
      // Create a readable stream for passing the data back from S3 and ignoring any errors that
      // take place initially while the data has not yet been processed.
      var Readable = Npm.require('stream').Readable;
      var out = new Readable();
      out._read = function() {};
      var tryFreq = options.tryFreq;
      var triesLeft = options.tries;
      var startStream = function() {
        var key = folder + fileKey;
        var stream = S3.createReadStream({
          Bucket: bucket,
          Key: key
        });
        stream.on('error', function(err) {
          if (triesLeft <= 0) {
            var error = new Error('Failed to download file ' + key + ' from S3 bucket ' + bucket);
            console.error(error.message);
            out.emit('error', error);
            out.push(null);
            return;
          }
          // Ignore errors and try again after a delay.
          setTimeout(startStream, tryFreq);
          triesLeft--;
        });
        stream.on('data', function(data) {
          out.push(data);
        });
        stream.on('end', function() {
          out.push(null);
        });
      };
      startStream();
      return out;
    },
    // Comment to documentation: Set options.ContentLength otherwise the
    // indirect stream will be used creating extra overhead on the filesystem.
    // An easy way if the data is not transformed is to set the
    // options.ContentLength = fileObj.size ...
    createWriteStream: function(fileKey, options) {
      options = options || {};

      if (options.contentType) {
        options.ContentType = options.contentType;
      }

      // We dont support array of aliases
      delete options.aliases;
      // We dont support contentType
      delete options.contentType;
      // We dont support metadata use Metadata?
      delete options.metadata;

      // Set options
      var options = FS.Utility.extend({
        Bucket: bucket,
        Key: folder + fileKey,
        fileKey: fileKey,
        ACL: defaultAcl
      }, options);

      return S3.createWriteStream(options);
    },
    remove: function(fileKey, callback) {

      S3.deleteObject({
        Bucket: bucket,
        Key: folder + fileKey
      }, function(error) {
        callback(error, !error);
      });
    },
    watch: function() {
      throw new Error("S3 storage adapter does not support the sync option");
    }
  });
};
