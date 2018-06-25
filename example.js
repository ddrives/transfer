const ddrive = require('@ddrive/core')
const memdb = require('memdb')
const dDriveImport = require('.')

const drive = ddrive(memdb())
const vault = drive.createVault()

const status = dDriveImport(vault, process.argv.slice(2), { live: true }, err => {
  if (err) throw err
  console.log('done')
  console.log('file count', status.fileCount)
})
