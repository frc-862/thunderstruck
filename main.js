// Modules to control application life and create native browser window
const electron = require('electron')
const {app, session, ipcMain, BrowserWindow, shell} = electron

const path = require('path')
const ssh = require('ssh2').Client
const scp = require('scp2')
const fs = require('fs')
const process = require('process')
const os = require('os')
//const sshkey = path.join(os.homedir(), '.ssh', 'id_rsa')
const sshkey = fs.readFileSync(path.join(os.homedir(), '.ssh', 'id_rsa')) + ""
let sshconn;

fs.mkdirSync(app.getPath('userData'), { recursive: true })
const configFileName = path.join(app.getPath('userData'), 'thunderstruck.json')
let lastConfigReadTime = undefined;
let config = readConfig();

global.config = config

fs.mkdirSync(config.localLogPath, { recursive: true })

sshcmd("ls -1", (err, result) => {
  if (err) {
    console.log("Error: " + err);
  } else {
    console.log(result);
  }
})

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow
let copyListSize = undefined

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)
watchConfig();

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
  console.log("Msg: " + arg)
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

ipcMain.on('config', (event, arg) => {
  console.log("edit config: " + configFileName);
  shell.openItem(configFileName) 
})

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
  flush_robot_log_files((err, result) => {
    if (!err) {
      event.sender.send('refresh', '')
    }
  })
})

function createWindow () {
  console.log(config)

  // Create the browser window.
  const { width, height } = electron.screen.getPrimaryDisplay().workAreaSize
  const percent = 0.90

  const renderer = path.join(app.getAppPath(), 'app', 'js', 'renderer.js')
  mainWindow = new BrowserWindow({
    width: Math.floor(width * percent), 
    height: Math.floor(height * percent),
    webPreferences: {
      //contextIsolation: false,
      nodeIntegration: true
      //allowRunningInsecureContent: true
      ////preload: renderer
    }
  })
  mainWindow.webContents.openDevTools()

  //session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    //callback({ responseHeaders: Object.assign({
      //"Content-Security-Policy": [ "script-src", "self", "unsafe-inline" ]
    //}, details.responseHeaders)});
  //});

  // and load the index.html of the app.
  const main = path.join(app.getAppPath(), 'app', 'index.html')
  mainWindow.loadURL(`file://${__dirname}/app/index.html`)

  workerWindow = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true }
  });
  workerWindow.loadURL(`file://${__dirname}/app/workder.html`)

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

function readConfig() {
  let result = {};

  try {
    result = JSON.parse( fs.readFileSync(configFileName) );
  } catch (err) {
    // create default config
    result = {
      localLogPath: path.join('~', 'greg_the_robot'),
      remoteLogPath: '/u/log',
      host: 'robotrio-862-frc.local',
      port: 22,
      username: 'admin'
    }
    fs.writeFileSync(configFileName, JSON.stringify(result))
  }
  lastConfigReadTime = Date.now();

  const homedir = os.homedir()
  Object.keys(result).forEach(function(key) {
    if (typeof(result[key]) === 'string') {
      let val = result[key] + ""
      result[key] = val.replace("~", homedir) 
    }
  })

  sshconn = {
    host: result.host,
    port: result.port,
    username: result.username,
    privateKey: sshkey
  };

  return result;
}

function fsize(fname) {
  try {
    const stats = fs.statSync(fname)
    return stats.size
  } catch (err) {
    return 0
  }
}

function copyList(list, source, dest, done) {
  if (copyListSize === undefined) {
    copyListSize = list.length
  }

  const finfo = list.shift()
  if (finfo) {
    const fname = finfo.filename
    mainWindow.send('percent', { percent: 1.0 - (list.length / copyListSize), file: fname})

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
    mainWindow.send('percent', { percent: 1.0, file: 'done'})
    copyListSize = undefined
    if (done != undefined) {
       done()
    }
  }
}

function sshcmd(cmd, done) {
  console.log(`Execute ${cmd}`)
  let result = ''

  try {
    const conn = new ssh()
    conn.on('ready', function() {
      conn.exec(cmd, function(err, stream) {
        if (err) {
          if (done !== undefined) 
            return done(err, undefined);
          else
            throw err;
        }

        stream.on('close', function(code, signal) {
          conn.end()

          if (done !== undefined) {
            done(undefined, result)
          }
        }).on('data', (data) => {
          result += data.toString();
        }).stderr.on('data', function(data) {
          result += data.toString();
        })
      })

    }).on('error', function(err) {
      if (done !== undefined) done(err, undefined);
    }).connect(sshconn);

  } catch (err) {
    if (done !== undefined) done(err, undefined);
  }
}

function flush_robot_log_files(done) {
  const cmd = `rm ${path.join(config.remoteLogPath, '*')}`
  sshcmd(cmd, (err, result) => {
    if (done) {
      done(err, result);
    }
  })
}

function syncFiles(done) {
  const conn = new ssh()
  const sftpFromPath = `${config["username"]}@${config["host"]}:${config["remoteLogPath"]}`

  fs.mkdir(config.localLogPath, function() { })

  console.log("attempt connect")
  conn.on('ready', function() {
    console.log("connect connected")
    conn.sftp(function(err, sftp) {
      console.log("starting sftp: " + config["remoteLogPath"])
      console.log(err)
      if (err) throw err
      sftp.readdir(config["remoteLogPath"], function(err, list) {
        console.log("readdir")
        console.log(err)
        if (err) throw err

        copyList(list, sftpFromPath, config.localLogPath, done)

        conn.end()
      })
    })
  }).connect(config)
}

function watchConfig() {
  fs.stat(configFileName, function(err, stat) {
    if (err) {
      console.log("Error: " + err);
      setTimeout(watchConfig, 10000);
    } else {
      if (lastConfigReadTime < stat.mtimeMs) {
        config = readConfig();
        console.log("Update global")
        global.config = config;
        console.log(config);
      }
      setTimeout(watchConfig, 3000);
    }
  });
}

