/*
 * najax
 * https://github.com/alanclarke/najax
 *
 * Copyright (c) 2012 Alan Clarke
 * Licensed under the MIT license.
 */

var https = require('https'),
    http = require('http'),
    querystring = require('querystring'),
    url = require('url'),
    q = require('./q'),
    _ = require('./lodash.compat'),
    najax = module.exports = request,
    default_settings = {
        type: 'GET',
        rejectUnauthorized: true
    };


/* set default settings */
module.exports.defaults = function (opts) {
    return _.extend(default_settings, opts);
};

function _parseOptions(options, a, b) {
    var args = [],
        opts = _.extend({}, default_settings);

    if (_.isString(options)) {
        opts.url = options;
    } else {
        _.extend(opts, options);
    }

    _.each([a, b], function (fn) {
        if (_.isFunction(fn)) {
            opts.success = fn;
        }
    });

    if (!_.isFunction(a)) {
        _.extend(opts, a);
    }

    return opts;
}

/* auto rest interface go! */
_.each('get post put delete head'.split(' '), function (method) {
    najax[method] = module.exports[method] = function (options, a, b) {
        var opts = _parseOptions(options, a, b);

        opts.type = method.toUpperCase();

        return najax(opts);
    };
});

/* main function definition */
function request(options, a, b) {
    //OPTIONS
    /*
        method overloading, can use:
        -function(url, opts, callback) or
        -function(opts)
        -function(url, callback)
    */
    var o,
        l,
        ssl,
        req,
        jqXHR,
        getopts,
        isSuccess,
        data = "",
        dfd = new q.defer();

    //REQUEST
    function notImplemented(name) {
        return function () {
            console.error('najax: method jqXHR."' + name + '" not implemented');
            console.trace();
        };
    }


    if (_.isString(options) || _.isFunction(a)) {
        return request(_parseOptions(options, a, b));
    }

    o = _.extend({}, default_settings, options);
    l = url.parse(o.url);
    ssl = l.protocol.indexOf('https') === 0;
    data = '';

    //DATA
    /* massage request data according to options */
    o.data = o.data || '';
    o.contentType = o.contentType ? 'application/' + o.contentType : 'application/x-www-form-urlencoded';

    if (!o.encoder) {
        switch (o.contentType) {
        case 'application/json':
            o.data = JSON.stringify(o.data);
            break;
        case 'application/x-www-form-urlencoded':
            o.data = querystring.stringify(o.data);
            break;
        default:
            o.data = o.data.toString();
        }
    } else {
        o.data = o.encoder(o.data);
    }

    /* if get, use querystring method for data */
    if (o.type === 'GET') {
        l.search = (l.search ? l.search + (o.data ? '&' + o.data : '') : (o.data ? '?' + o.data : ''));
    }

    /* if get, use querystring method for data */
    options = {
        host: l.hostname,
        path: l.pathname + (l.search || ''),
        method: o.type,
        port: l.port || (ssl ? 443 : 80),
        headers: {},
        rejectUnauthorized: o.rejectUnauthorized
    };

    /* set data content type */
    if (o.type !== 'GET' && o.data) {
        o.data = o.data + '\n';
        options.headers = {
            'Content-Type': o.contentType + ';charset=utf-8',
            'Content-Length': o.data ? Buffer.byteLength(o.data) : 0
        };
    }

    //AUTHENTICATION
    /* add authentication to http request */
    if (l.auth) {
        options.auth = l.auth;
    } else if (o.username && o.password) {
        options.auth = o.username + ':' + o.password;
    } else if (o.auth) {
        options.auth = o.auth;
    }

    /* apply header overrides */
    if (typeof o.headers != "undefined" && typeof options.headers == "undefined") {
        options.headers = {};
    }

    _.extend(options.headers, o.headers);
    _.extend(options, _.pick(o, ['auth', 'agent']));

    /* for debugging, method to get options and return */
    if (o.getopts) {
        getopts = [ssl, options, o.data || false, o.success || false, o.error || false];

        return getopts;
    }

    jqXHR = {
        readyState: 0,
        status: 0,
        statusText: 'error', // one of: "success", "notmodified", "error", "timeout", "abort", or "parsererror"
        setRequestHeader: notImplemented('setRequestHeader'),
        getAllResponseHeaders: notImplemented('getAllResponseHeaders'),
        statusCode: notImplemented('statusCode'),
        abort: notImplemented('abort')
    };


    req = (ssl ? https : http).request(options, function (res) {
        // Allow getting Response Headers from the XMLHTTPRequest object
        dfd.getResponseHeader = jqXHR.getResponseHeader = function (header) {
            return res.headers[header.toLowerCase()];
        };

        res.on('data', function (d) {
            data += d;
        });

        res.on('end', function () {
            if (o.dataType === 'json') {
                //replace control characters
                try {
                    data = JSON.parse(data.replace(/[\cA-\cZ]/gi, ''));
                } catch (e) {
                    return !o.error || o.error(jqXHR, res.statusCode, e);
                }
            }

            // Determine if successful
            isSuccess = res.statusCode >= 200 && res.statusCode < 300 || res.statusCode === 304;
            // Set readyState
            jqXHR.readyState = res.statusCode > 0 ? 4 : 0;
            jqXHR.status = res.statusCode;

            if (isSuccess) {
                // Set data for the fake xhr object
                jqXHR.statusText = 'success';

                // success, statusText, jqXHR
                dfd.resolve(data, 'success', jqXHR);
            } else {
                // jqXHR, statusText, error
                // When an HTTP error occurs, errorThrown receives the textual portion of the
                // HTTP status, such as "Not Found" or "Internal Server Error."
                if (_.isFunction(o.error)) {
                    o.error(jqXHR, 'error', http.STATUS_CODES[res.statusCode]);
                }
                dfd.reject(jqXHR, 'error', http.STATUS_CODES[res.statusCode]);
            }
        });
    });
    //ERROR
    req.on('error', function (e) {
        // Set data for the fake xhr object
        jqXHR.responseText = e.stack;

        if (_.isFunction(o.error)) {
            o.error(jqXHR, 'error', e);
        }
        // jqXHR, statusText, error
        dfd.reject(jqXHR, 'error', e);
    });


    // SET TIMEOUT
    if (o.timeout && o.timeout > 0) {
        req.on('socket', function (socket) {
            socket.setTimeout(o.timeout);
            socket.on('timeout', function () {
                req.abord();
            });
        });
    }

    //SEND DATA
    if (o.type !== 'GET' && o.data) {
        req.write(o.data, 'utf-8');
    }

    req.end();

    //DEFERRED
    dfd.success = dfd.done;
    dfd.error = dfd.fail;

    return dfd.promise;
}
