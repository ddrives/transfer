'use strict'

const test = require('tape')
const ddrive = require('@ddrive/core')
const memdb = require('memdb')
const dDriveImport = require('..')
const fs = require('fs')
const path = require('path')
const raf = require('@dwcore/ref')

const sort = entries => entries.sort((a, b) => a.name.localeCompare(b.name))

test('dDrive Transfer Tests: cleanup', t => {
  const base = `${__dirname}/fixture/a/b/c`
  fs.readdirSync(base)
  .filter(file => ['d.txt', 'e.txt'].indexOf(file) === -1)
  .forEach(file => fs.unlinkSync(`${base}/${file}`))
  t.end()
})

test('dDrive Transfer Tests: import directory', t => {
  t.plan(8)

  const drive = ddrive(memdb())
  const vault = drive.createVault()
  const status = dDriveImport(vault, `${__dirname}/fixture/a/b/c/`, err => {
    t.error(err)

    vault.list((err, entries) => {
      t.error(err)
      entries = sort(entries)
      t.equal(entries.length, 3)
      t.equal(entries[0].name, '')
      t.equal(entries[1].name, 'd.txt')
      t.equal(entries[2].name, 'e.txt')
      t.equal(status.fileCount, 2)
      t.equal(status.totalSize, 9)
    })
  })
})

test('dDrive Transfer Tests: import file', t => {
  t.plan(6)

  const drive = ddrive(memdb())
  const vault = drive.createVault()
  const status = dDriveImport(vault, `${__dirname}/fixture/a/b/c/d.txt`, err => {
    t.error(err)

    vault.list((err, entries) => {
      t.error(err)
      entries = sort(entries)
      t.equal(entries.length, 1)
      t.equal(entries[0].name, 'd.txt')
      t.equal(status.fileCount, 1)
      t.equal(status.totalSize, 4)
    })
  })
})

test('dDrive Transfer Tests: resume', t => {
  t.plan(12)

  const drive = ddrive(memdb())
  const vault = drive.createVault()
  let status = dDriveImport(vault, `${__dirname}/fixture/a/b/c/`, {
    resume: true
  }, err => {
    t.error(err)
    vault.createFileWriteStream('d.txt').on('finish', () => {
      status = dDriveImport(vault, `${__dirname}/fixture/a/b/c/`, {
        resume: true
      }, err => {
        t.error(err)
      })
      status.on('file imported', file => {
        t.equal(file.mode, 'updated', 'updated')
        t.equal(status.fileCount, 3)
        t.equal(status.totalSize, 13)
      })
      status.on('file skipped', file => {
        t.equal(file.path, `${__dirname}/fixture/a/b/c/e.txt`)
      })
    }).end('bleerg')
  })

  let i = 0
  status.on('file imported', file => {
    t.equal(file.mode, 'created', 'created')
    if (!i++) {
      t.equal(status.fileCount, 1)
      t.equal(status.totalSize, 4)
    } else {
      t.equal(status.fileCount, 2)
      t.equal(status.totalSize, 9)
    }
  })
})

test('dDrive Transfer Tests: resume with raf', t => {
  t.plan(12)

  const drive = ddrive(memdb())
  const dir = `${__dirname}/fixture/a/b/c/`
  const vault = drive.createVault({
    file: function (name) {
      return raf(path.join(dir, name))
    }
  })
  let status = dDriveImport(vault, dir, {
    resume: true
  }, err => {
    t.error(err)
    fs.writeFile(`${__dirname}/fixture/a/b/c/d.txt`, 'foo\n', () => {
      status = dDriveImport(vault, dir, {
        resume: true
      }, err => {
        t.error(err)
      })
      status.on('file imported', file => {
        if (file.path !== `${__dirname}/fixture/a/b/c/d.txt`) t.fail('wrong file')
        t.equal(file.mode, 'updated', 'uped')
        t.equal(status.fileCount, 2)
        t.equal(status.totalSize, 9)
      })
      status.on('file skipped', file => {
        t.equal(file.path, `${__dirname}/fixture/a/b/c/e.txt`)
      })
    })
  })

  let i = 0
  status.on('file imported', file => {
    t.equal(file.mode, 'created', 'created')
    if (!i++) {
      t.equal(status.fileCount, 1)
      t.equal(status.totalSize, 4)
    } else {
      t.equal(status.fileCount, 2)
      t.equal(status.totalSize, 9)
    }
  })
})

if (!process.env.TRAVIS) {
  test('dDrive Transfer Tests: resume & live', t => {
    t.plan(10)

    const drive = ddrive(memdb())
    const vault = drive.createVault()
    let status = dDriveImport(vault, `${__dirname}/fixture/a/b/c/`, {
      resume: true,
      live: true
    }, err => {
      t.error(err, 'initial import')
      const tmp = `${__dirname}/fixture/a/b/c/${Math.random().toString(16).slice(2)}`

      status.once('file imported', file => {
        t.equal(file.mode, 'created', 'created')
        t.equal(status.fileCount, 3, 'file count')
        t.equal(status.totalSize, 11, 'total size')

        status.once('file imported', file => {
          t.equal(file.mode, 'updated', 'updated')
          t.equal(status.fileCount, 3, 'file count')
          t.equal(status.totalSize, 12, 'total size')
          status.close()
          fs.unlink(tmp, err => t.error(err, 'file removed'))
        })

        fs.writeFile(tmp, 'you', err => t.error(err, 'file updated'))
      })
      fs.writeFile(tmp, 'yo', err => t.error(err, 'file created'))
    })
  })
}

test('dDrive Transfer Tests: optional callback', t => {
  t.plan(1)

  const drive = ddrive(memdb())
  const vault = drive.createVault()
  let status = dDriveImport(vault, `${__dirname}/fixture/a/b/c/`)
  status.once('file imported', () => t.ok(true))
})

test('dDrive Transfer Tests: ignore', t => {
  const drive = ddrive(memdb())
  const vault = drive.createVault()
  const status = dDriveImport(vault, `${__dirname}/fixture/ignore`, {
    ignore: /\/\.dpack\//,
    live: true
  }, err => {
    t.error(err, 'no error importing')
    fs.writeFile(`${__dirname}/fixture/ignore/.dpack/beep.txt`, 'boop', err => {
      t.error(err, 'no error writing file')
      t.end()
      status.close()
    })
  })
  status.on('file imported', () => t.ok(false))
})

test('dDrive Transfer Tests: duplicate directory', t => {
  const drive = ddrive(memdb())
  const vault = drive.createVault()
  const directory = `${__dirname}/fixture/a/b/c/`

  dDriveImport(vault, directory, err => {
    t.error(err)
    dDriveImport(vault, directory, {
      resume: true
    }, err => {
      t.error(err)
      vault.list((err, entries) => {
        t.error(err)

        entries = sort(entries)
        t.equal(entries.length, 3)
        t.equal(entries[0].name, '')
        t.equal(entries[1].name, 'd.txt')
        t.equal(entries[2].name, 'e.txt')
        t.end()
      })
    })
  })
})

test('dDrive Transfer Tests: import directory with basePath', t => {
  t.plan(8)

  const drive = ddrive(memdb())
  const vault = drive.createVault()
  const status = dDriveImport(vault, `${__dirname}/fixture/a/b/c/`, { basePath: 'foo/bar' }, err => {
    t.error(err)

    vault.list((err, entries) => {
      t.error(err)
      entries = sort(entries)
      t.equal(entries.length, 3)
      t.equal(entries[0].name, 'foo/bar')
      t.equal(entries[1].name, 'foo/bar/d.txt')
      t.equal(entries[2].name, 'foo/bar/e.txt')
      t.equal(status.fileCount, 2)
      t.equal(status.totalSize, 9)
    })
  })
})

test('dDrive Transfer Tests: import file with basePath', t => {
  t.plan(6)

  const drive = ddrive(memdb())
  const vault = drive.createVault()
  const status = dDriveImport(vault, `${__dirname}/fixture/a/b/c/d.txt`, { basePath: 'foo/bar' }, err => {
    t.error(err)

    vault.list((err, entries) => {
      t.error(err)
      entries = sort(entries)
      t.equal(entries.length, 1)
      t.equal(entries[0].name, 'foo/bar/d.txt')
      t.equal(status.fileCount, 1)
      t.equal(status.totalSize, 4)
    })
  })
})

// NOTE: this test must be last
test('chokidar bug', t => {
  // chokidar sometimes keeps the process open
  t.end()
  process.exit()
})
