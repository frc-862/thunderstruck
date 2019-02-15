// Modules to control application life and create native browser window
const electron = require('electron')
const {app, session, ipcMain, BrowserWindow} = electron

const path = require('path')
const ssh = require('ssh2').Client
const scp = require('scp2')
const fs = require('fs')
const os = require('os')
const homedir = os.homedir()
const config = JSON.parse( fs.readFileSync('thunderstruck.json') ) 
Object.keys(config).forEach(function(key) {
  let val = config[key] + ""
  config[key] = val.replace("~", homedir) 
})

const sftpToPath = config["localLogPath"]

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow

function fsize(fname) {
  try {
    const stats = fs.statSync(fname)
    return stats.size
  } catch (err) {
    return 0
  }
}

let copyListSize = undefined

function copyList(list, source, dest, done) {
  if (copyListSize === undefined) {
    copyListSize = list.length
    mainWindow.send('percent', 0.0)
  } else {
    mainWindow.send('percent', 1.0 - (list.length / copyListSize))
  }

  if (list.length > 0) {
    const finfo = list.shift()
    const fname = finfo.filename
    const destName = path.join(dest, fname)

    if (finfo.attrs.size > fsize(destName)) {
      const from = source + '/' + fname
      const to = path.join(dest, fname)
      scp.scp(from, to, function(err) {
        copyList(list, source, dest, done)
      })
    } else {
      copyList(list, source, dest, done)
    }
  } else {
    console.log("copyList exit")
    mainWindow.send('percent', 1.0)
    copyListSize = undefined
    if (done != undefined) {
       done()
    }
  }
}

function flush_robot_log_files(done) {
  const cmd = `rm ${path.join(config['logPath'], '*')}`
  console.log(`Execute ${cmd}`)
  return

  const conn = new ssh()
  conn.on('ready', function() {
    try {

      conn.exec(cmd, function(err, stream) {
        if (err) throw err
        stream.on('close', function(code, signal) {
          console.log('Stream :: close :: code: ' + code + ', signal: ' + signal)
          conn.end()
        }).on('data', function(data) {
          console.log('STDOUT: ' + data)
        }).stderr.on('data', function(data) {
          console.log('STDERR: ' + data)
        })
      })

    } finally {
      conn.end()
    }

    if (done !== undefined) {
      done()
    }
  })
}

function syncFiles(done) {
  const conn = new ssh()
  const sftpFromPath = `${config["username"]}@${config["host"]}:${config["logPath"]}`

  fs.mkdir(sftpToPath, function() { })

  console.log("attempt connect")
  conn.on('ready', function() {
    console.log("connect connected")
    conn.sftp(function(err, sftp) {
      console.log("starting sftp: " + config["logPath"])
      console.log(err)
      if (err) throw err
      sftp.readdir(config["logPath"], function(err, list) {
        console.log("readdir")
        console.log(err)
        if (err) throw err

        copyList(list, sftpFromPath, sftpToPath, done)

        conn.end()
      })
    })
  }).connect(config)
}

function createWindow () {
  console.log(config)

  // Create the browser window.
  const { width, height } = electron.screen.getPrimaryDisplay().workAreaSize
  const percent = 0.90

  const renderer = path.join(app.getAppPath(), 'app', 'js', 'renderer.js')
  mainWindow = new BrowserWindow({
    width: Math.floor(width * percent), 
    height: Math.floor(height * percent)
    //webPreferences: {
      //contextIsolation: false,
      //nodeIntegration: true,
      //allowRunningInsecureContent: true
      ////preload: renderer
    //}
  })

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: Object.assign({
      "Content-Security-Policy": [ "default-src 'self'" ]
    }, details.responseHeaders)})
  })


  // and load the index.html of the app.
  const main = path.join(app.getAppPath(), 'app', 'index.html')
  mainWindow.loadFile(main)

  console.log('sending to ')
  console.log(mainWindow)
  mainWindow.send('percent', 'done')
  console.log('sent')

  // Open the DevTools.
  //mainWindow.webContents.openDevTools()

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', function () {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

ipcMain.on('asynchronous-message', (event, arg) => {
  if (arg === "sync") {
    syncFiles(() => event.sender.send('sync', 'ack'))
  } else if (arg === "flush") {
    const logDir = config["localLogPath"]
    fs.readdir(logDir, (err, files) => {
      files.forEach(file => {
        console.log(`flush ${file}`)
        fs.unlink(path.join(logDir, file), () => {})
      })
    })

    event.sender.send('flush', 'ack')
  }
})

function unlink_list(list, done) {
  if (list.length == 0) {
    if (done !== undefined) {
      done()
    }
  } else {
    const logDir = config["localLogPath"]
    const fname = list.shift()
    //console.log(`unlink('${fname}')`)

    fs.unlink(path.join(logDir, fname), () => {
      unlink_list(list, done)
    })
  }
}

ipcMain.on('flush-local', (event, arg) => {
  console.log('flushing local files')

  const logDir = config["localLogPath"]
  fs.readdir(logDir, (err, files) => {
    unlink_list(files, () => {
      console.log('local flush complete')
      event.sender.send('refresh', '')
    })
  })
})

ipcMain.on('sync-robot', (event, arg) => {
  console.log('sync logs with robot')
  event.sender.send('refresh', '')
  syncFiles(() => {
    console.log('sync with roborio complete')
    event.sender.send('refresh', '')
  })
})

ipcMain.on('flush-robot', (event, arg) => {
  console.log('flushing robot files')
  flush_robot_log_files(() => {
    event.sender.send('refresh', '')
  })
})

