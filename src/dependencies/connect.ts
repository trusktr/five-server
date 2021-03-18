/* eslint-disable prefer-spread */

/*!
 * connect
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * Copyright(c) 2015 Douglas Christopher Wilson
 * MIT Licensed
 */

// modified version of connect@3.7.0 (https://github.com/senchalabs/connect/blob/master/index.js)

const debug = require('debug')('connect:dispatcher')
const EventEmitter = require('events').EventEmitter
const finalhandler = require('finalhandler')
const http = require('http')
const parseUrl = require('parseurl')

const env = process.env.NODE_ENV || 'development'

/* istanbul ignore next */
const defer =
  typeof setImmediate === 'function'
    ? setImmediate
    : function (fn) {
        process.nextTick(fn.bind.apply(fn, arguments))
      }

// eslint-disable-next-line no-redeclare
export default class Server extends EventEmitter {
  route = '/'
  stack: any[] = []

  constructor() {
    super()
  }

  public static create() {
    const instance = new Server()

    return Object.assign((req, res?, out?) => instance.call(req, res, out), {
      use: (route, fn?: any) => instance.use(route, fn),
      handle: (req, res, out) => instance.handle(req, res, out),
      listen: () => instance.listen()
      // ... forward other methods
    })
  }

  public call(req, res?, out?): void {
    this.handle(req, res, out)
  }

  use(route, fn?: any) {
    let handle = fn
    let path = route

    // default route to '/'
    if (typeof route !== 'string') {
      handle = route
      path = '/'
    }

    // wrap sub-apps
    if (typeof handle.handle === 'function') {
      const server = handle
      server.route = path
      handle = function (req, res, next) {
        server.handle(req, res, next)
      }
    }

    // wrap vanilla http.Servers
    if (handle instanceof http.Server) {
      handle = handle.listeners('request')[0]
    }

    // strip trailing slash
    if (path[path.length - 1] === '/') {
      path = path.slice(0, -1)
    }

    // add the middleware
    debug('use %s %s', path || '/', handle.name || 'anonymous')
    this.stack.push({ route: path, handle: handle })

    return this
  }

  handle(req, res, out) {
    let index = 0
    const protohost = getProtohost(req.url) || ''
    let removed = ''
    let slashAdded = false
    const stack = this.stack

    // final function handler
    const done =
      out ||
      finalhandler(req, res, {
        env: env,
        onerror: logerror
      })

    // store the original URL
    req.originalUrl = req.originalUrl || req.url

    function next(err?: any) {
      if (slashAdded) {
        req.url = req.url.substr(1)
        slashAdded = false
      }

      if (removed.length !== 0) {
        req.url = protohost + removed + req.url.substr(protohost.length)
        removed = ''
      }

      // next callback
      const layer = stack[index++]

      // all done
      if (!layer) {
        defer(done, err)
        return
      }

      // route data
      const path = parseUrl(req).pathname || '/'
      const route = layer.route

      // skip this layer if the route doesn't match
      if (path.toLowerCase().substr(0, route.length) !== route.toLowerCase()) {
        return next(err)
      }

      // skip if route match does not border "/", ".", or end
      const c = path.length > route.length && path[route.length]
      if (c && c !== '/' && c !== '.') {
        return next(err)
      }

      // trim off the part of the url that matches the route
      if (route.length !== 0 && route !== '/') {
        removed = route
        req.url = protohost + req.url.substr(protohost.length + removed.length)

        // ensure leading slash
        if (!protohost && req.url[0] !== '/') {
          req.url = `/${req.url}`
          slashAdded = true
        }
      }

      // call the layer handle
      call(layer.handle, route, err, req, res, next)
    }

    next()
  }

  listen() {
    const server = http.createServer(this)
    return server.listen.apply(server, arguments)
  }
}

function call(handle, route, err, req, res, next) {
  const arity = handle.length
  let error = err
  const hasError = Boolean(err)

  debug('%s %s : %s', handle.name || '<anonymous>', route, req.originalUrl)

  try {
    if (hasError && arity === 4) {
      // error-handling middleware
      handle(err, req, res, next)
      return
    } else if (!hasError && arity < 4) {
      // request-handling middleware
      handle(req, res, next)
      return
    }
  } catch (e) {
    // replace the error
    error = e
  }

  // continue
  next(error)
}

function logerror(err) {
  if (env !== 'test') console.error(err.stack || err.toString())
}

function getProtohost(url) {
  if (url.length === 0 || url[0] === '/') {
    return undefined
  }

  const fqdnIndex = url.indexOf('://')

  return fqdnIndex !== -1 && url.lastIndexOf('?', fqdnIndex) === -1
    ? url.substr(0, url.indexOf('/', 3 + fqdnIndex))
    : undefined
}