var http = require('http')
var fs = require('fs')
var body = require('body/json')
var exec = require('child_process').exec
var ndjson = require('ndjson')
var gasket = require('gasket')
var peek = require('peek-stream')
var csv = require('csv-parser')
var passthrough = require('stream').PassThrough
var path = require('path')
var through = require('through2')
var split = require('split')
var pumpify = require('pumpify')
var tmp = require('tmp')


var isCSV = function(data) {
  return data.toString().indexOf(',') > -1
}

var isJSON = function(data) {
  try {
    JSON.parse(data)
    return true
  } catch (err) {
    return false
  }
}

var parse = function() {
  return peek(function(data, swap) {
    // maybe it is JSON?
    if (isJSON(data)) return swap(null, ndjson.parse({strict: false}))

    // maybe it is CSV?
    if (isCSV(data)) return swap(null, csv())

    // pass through everything else
    
    var fallback = pumpify.obj(
      split(),
      through.obj(function (chunk, enc, cb) {
        cb(null, {row: chunk})
      })
    )

    swap(null, fallback)
  })
}



var cmd = []


function sse(res) {
  res.setHeader('Content-Type', 'text/event-stream')
  console.log('Run ', cmd.join(' | '))
  
  // TODO: this doesn't seem to cleanup correctly
  tmp.dir({unsafeCleanup: true}, function (err, tmpPath) {
    if(err) throw err
      console.log(tmpPath)
    
    // insert caching
    var pipeline = cmd.reduce(function (pre, curr, i) {
      pre.push(curr)
      pre.push('save-through ' + path.resolve(tmpPath, i + '.cache'))
      return pre
    }, [])

    gasket(pipeline).run('main')
      .pipe(parse())
      .pipe(through.obj(function (data, enc, cb) {
        this.push('data: ' + JSON.stringify(data) + '\n\n')
        cb(null)
      }))
      .pipe(res)
    
  })
  

}

module.exports = function (port) {
  http.createServer(function (req,res) {
    if(req.url === '/bundle.js')
      return fs.createReadStream(path.resolve(__dirname, 'bundle.js')).pipe(res)
      
    if(req.url === '/sse') {
      return sse(res)
    } 
    
    if(req.method === 'POST') {
      body(req, function (err, body) {
        if(err) return console.error(err)
        cmd = body.cmd
        res.write('end')
        res.end()
      })
    } else {
      fs.createReadStream(path.resolve(__dirname, 'index.html'))
        .pipe(res)
    }
  }).listen(port)
}

