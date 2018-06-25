'use strict'

const dWebChannel = require('@dwcore/channel')
const fs = require('fs')
const join = require('path').join
const relative = require('path').relative
const basename = require('path').basename
const EventEmitter = require('events').EventEmitter
const chokidar = require('chokidar')
const series = require('run-series')
const match = require('anymatch')

const noop = () => {}

module.exports = (vault, target, opts, cb) => {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  opts = opts || {}

  const emitError = (err) => err && status.emit('error', err)
  cb = cb || emitError

  const basePath = (typeof opts.basePath === 'string') ? opts.basePath : ''
  const entries = {}
  let watcher

  if (opts.live) {
    watcher = chokidar.watch([target], {
      persistent: true,
      ignored: opts.ignore
    })
    watcher.once('ready', () => {
      watcher.on('add', path => consume(path))
      watcher.on('change', path => consume(path))
      watcher.on('unlink', path => noop) // TODO
    })
  }

  const status = new EventEmitter()
  status.close = () => watcher && watcher.close()
  status.fileCount = 0
  status.totalSize = 0

  const consume = (file, cb) => {
    if (opts.ignore && match(opts.ignore, file)) return cb()
    fs.stat(file, (err, stat) => {
      if (err) return cb(err)
      if (stat.isDirectory()) {
        consumeDir(file, stat, cb)
      } else {
        consumeFile(file, stat, cb)
      }
    })
  }

  const consumeFile = (file, stat, cb) => {
    cb = cb || emitError
    const dDrivePath = file === target
      ? joinDDatabasePath(basePath, basename(file))
      : joinDDatabasePath(basePath, relative(target, file))
    const next = mode => {
      const rs = fs.createReadStream(file)
      const ws = vault.createFileWriteStream({
        name: dDrivePath,
        mtime: stat.mtime
      })
      dWebChannel(rs, ws, err => {
        if (err) return cb(err)
        entry = entries[dDrivePath] = entry || {}
        entry.length = stat.size
        entry.mtime = stat.mtime.getTime()
        status.emit('file imported', {
          path: file,
          mode
        })
        cb()
      })
    }

    let entry = entries[dDrivePath]
    if (!entry) {
      status.fileCount++
      status.totalSize += stat.size
      next('created')
    } else if (entry.length !== stat.size || entry.mtime !== stat.mtime.getTime()) {
      status.totalSize = status.totalSize - entry.length + stat.size
      next('updated')
    } else {
      status.emit('file skipped', { path: file })
      cb()
    }
  }

  const consumeDir = (file, stat, cb) => {
    cb = cb || emitError
    const dDrivePath = joinDDatabasePath(basePath, relative(target, file))
    let entry = entries[dDrivePath]

    const next = () => {
      entry = entries[dDrivePath] = entry || {}
      entry.mtime = stat.mtime.getTime()

      fs.readdir(file, (err, _files) => {
        if (err) return cb(err)
        series(_files.map(_file => done => {
          consume(join(file, _file), done)
        }), cb)
      })
    }

    if (entry && entry.mtime === stat.mtime.getTime()) {
      next()
    } else {
      vault.append({
        name: dDrivePath,
        type: 'directory',
        mtime: stat.mtime
      }, next)
    }
  }

  const next = () => {
    consume(target, cb || emitError)
  }

  if (opts.resume) {
    vault.list({ live: false })
    .on('error', cb)
    .on('data', entry => {
      entries[entry.name] = entry
      if (entry.type === 'directory') return
      status.fileCount++
      status.totalSize += entry.length
    })
    .on('end', next)
  } else {
    next()
  }

  return status
}

function joinDDatabasePath (base, path) {
  path = join(base, path)
  if (path === '.') {
    // '.' is returned when base is '' and path is '': aka, the root directory
    // in ddrive, root should be '' or '/', so we replace it with this special case
    return ''
  }
  return path
}
