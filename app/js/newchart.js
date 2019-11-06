const electron = require('electron').remote
const {app} = electron
const path = electron.require('path')
const fs = electron.require('fs');

const {ipcRenderer} = require('electron')

var data = [];
var ws = undefined;
var chart = undefined;

console.log(electron)
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
  console.log("sub dir: " + $("#logfolders").val())

  const baseFolder = electron.getGlobal("config").localLogPath;
  fs.readdir(baseFolder, (err, listings) => {
    const currentDir = $("#logfolders").val()

    listings.sort()
    let dirs = listings.filter(fn => fs.statSync(path.join(baseFolder, fn)).isDirectory())

    $("#logfolders").empty();
    $("#logfolders").append(`<option value="${baseFolder}">.</option>`)
    dirs.forEach(d => {
      $("#logfolders").append(`<option value="${path.join(baseFolder, d)}">${d}</option>`)
    });

    if (currentDir != '.') {
      $(`#logfolders option[value="${currentDir}"]`).prop("selected", "selected");
    }

    const logFolder = $("#logfolders").val()
    console.log("refresh_lognames: " + logFolder)

    let first = undefined
    const currentLog = $("#lognames").val()

    fs.readdir(logFolder, (err, listings) => {
      $("#lognames").empty()
      listings.sort()
      let files = listings.filter(fn => fs.statSync(path.join(logFolder, fn)).isFile())

      files.forEach(file => {
        const url = `file://${path.join(logFolder, file)}`

        $("#lognames").append(`<option value="${url}">${file}</option>`)
        if (first === undefined) {
          first = url
          //configureChart(url)
        }
      });

      if (first === undefined) {
        $("#lognames").append('<option value="">No logfiles available</option>')
      }

      if (currentLog != "") {
        console.log("Update currentlog: " + currentLog);
        const opt = $(`#lognames option[value="${currentLog}"]`)
        if (opt.length >= 1) {
          console.log("found currentlog: " + currentLog);
          opt.prop("selected", "selected");
          first = undefined;
        }
      } 

      if (first) {
        console.log("Update chart");
        changeData(first);
      }

    })
  });
}

$(document).ready(function () {
  refresh_lognames()

  ipcRenderer.on('refresh', (event, arg) => { 
    console.log('refreshing')
    refresh_lognames() 
  })

  ipcRenderer.on('percent', (event, arg) => {
    if (arg.percent >= 1.0) {
       $("#status").text('Sync complete')
    } else {
       $("#status").text(`Progress ${Math.round(arg.percent * 100)}% - ${arg.file}`)
    }
  })

  console.log("setting up")
  $(".exec").click(function() {
    console.log("ID: " + this.id);
    ipcRenderer.send(this.id, this);
  })

  ipcRenderer.on('newFolders', (event, arg) => {
    console.log("update folders");
    console.log(event);
    console.log(arg);
  });

  ipcRenderer.on('updateRemoteFiles', (event, files) => {
    $("#remotenames").empty()
    if (files.length == 0) {
      $("#remotenames").append(`<option value="">*** No remote logs found ***</option>`)
    } else {
      files.forEach(fn => {
        $("#remotenames").append(`<option value="${fn}">${fn}</option>`)
      });
    }
  });
});

