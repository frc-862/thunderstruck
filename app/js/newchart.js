
const electron = require('electron').remote
const {app} = electron
const path = electron.require('path')
const fs = electron.require('fs');

const {ipcRenderer} = require('electron')

var data = [];
var ws = undefined;
var chart = undefined;

function change(el) {
}

function buildLabels() {
}

function changeData(fname) {
  console.log("ChangeData: " + fname)
  configureChart(fname)
  //chart.update({ series: [] }, true, true)
  //chart.update({
    //data: {
      //csvURL: fname
    //}
  //}, true, true);
}

function configureChart(fname) {
  $.get(fname, function(csv) {
    chart = Highcharts.chart('graph1', {
      chart: {
        zoomType: 'x'
      },

      title: {
        text: 'Lightning Robotics Onboard Logging'
      },

      boost: {
        useGPUTranslations: true
      },

      data: {
        csv: csv,
      //csvURL: fname
        complete: function (mychart) {
          console.log("COMPLETE")
          console.log(mychart)
          $.each(mychart.series, function(index, val) {
            val.visible = (index == 0);
          });
        }
      },

      //subtitle: {
      //text: 'Source: thesolarfoundation.com'
      //},

      xAxis: {
        title: {
          text: "Seconds"
        }
      },

      yAxis: {
        title: {
          text: ''
        }
      },

      legend: {
        layout: 'vertical',
        align: 'right',
        verticalAlign: 'middle'
      },

      events: {
      },

      //plotOptions: {
      //series: {
      //label: {
      //connectorAllowed: false
      //},
      //pointStart: 2010
      //}
      //},

      responsive: {
        rules: [{
          condition: {
            maxWidth: 500
          },
          chartOptions: {
            legend: {
              layout: 'horizontal',
              align: 'center',
              verticalAlign: 'bottom'
            }
          }
        }]
      }
    })
  })
}

function refresh_lognames() {
  const logFolder = path.join(app.getPath('documents'), "logs")
  console.log("refresh_lognames: " + logFolder)

  let first = undefined
  fs.readdir(logFolder, (err, files) => {
    $("#lognames").empty()
    files.sort()
    files.forEach(file => {
      const url = `file://${path.join(logFolder, file)}`

      $("#lognames").append(`<option value="${url}">${file}</option>`)
      if (first === undefined) {
        first = file
        configureChart(url)
      }
    });
  })
}

$(document).ready(function () {
  const logFolder = path.join(app.getPath('documents'), "logs")
  console.log("PTH Log Folder: " + logFolder)

  ipcRenderer.send('pth', 'it works')

  refresh_lognames()

  ipcRenderer.on('refresh', (event, arg) => { 
    console.log('refreshing')
    refresh_lognames() 
  })

  ipcRenderer.on('percent', (event, arg) => {
    if (arg == 1.0) {
       $("#status").text('')
    } else {
       $("#status").text(`Progress ${Math.round(arg * 100)}%`)
    }
  })

  $(".sync").click(function() {
    ipcRenderer.send('sync-robot')
  })

  $(".flush-local").click(function() {
    ipcRenderer.send('flush-local', "flush")
  })

  $(".flush-robot").click(function() {
    ipcRenderer.send('flush-robot', "flush")
  })

});

