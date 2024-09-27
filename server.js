require('dotenv').config()

const express = require('express')
const { createServer } = require("node:http")
const createHttpsServer = require("node:https")
const session = require('express-session')
const passport = require('passport')
const flash = require('connect-flash')
const bodyParser = require('body-parser')
const { Server } = require('socket.io')
const path = require('path')
const fs = require('fs')
const Tile38 = require('tile38');
const pool = require('./config/database.js');

const client = new Tile38();

const privateKey  = fs.readFileSync('certs/poilloi.test.key', 'utf8');
const certificate = fs.readFileSync('certs/poilloi.test.crt', 'utf8');
const credentials = {key: privateKey, cert: certificate};


const app = express()
const httpServer = createServer(app)
const httpsServer = createHttpsServer.createServer(credentials, app)
const io = new Server(httpsServer)

const PORT = process.env.PORT || 3000

const sessionMiddleware = session({ secret: "thatsecretthinggoeshere", resave: false, saveUninitialized: true });


app.use(express.static(path.join(__dirname, 'public')))

const routes = require('./routes/index')

app.set('view engine', 'ejs')



app.use(sessionMiddleware);
app.use(bodyParser.urlencoded({
    extended: true
}))
app.use(bodyParser.json())
app.use(flash())
app.use(passport.initialize())
app.use(passport.session())

app.use(function(req, res, next){
    res.locals.message = req.flash('message');
    next();
});



app.use('/', routes)
require('./config/passport')(passport)


// convert a connect middleware to a Socket.IO middleware
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
  io.use(wrap(sessionMiddleware));
  io.use(wrap(passport.initialize()));
  io.use(wrap(passport.session()));
  
  io.use((socket, next) => {
    if (socket.request.user) {
      next();
    } else {
      next(new Error('unauthorized'))
    }
  });
  
  io.on('connect', (socket) => {
    console.log(`new connection ${socket.id}`);
    socket.data.userid = socket.request.user.userid;
    socket.on('whoami', (cb) => {
      cb(socket.request.user ? socket.request.user.username : '');
    });

      // when the client emits 'new message', this listens and executes
    socket.on('new message', (data) => {
    // we tell the client to execute 'new message'
        console.log(`socket message: from ${socket.request.user.userid}: ${data}`);
        const obj = JSON.parse(data);
        client.set('fleet', socket.request.user.userid, [obj.lat, obj.lon]).then(() => {
            console.log("done");
        }).catch(err => {
            console.error(err);
        });

    });
    socket.on('init position', (data) => {
      // we tell the client to execute 'new message'
      console.log(`init position: from ${socket.request.user.userid}: ${data}`);
      const obj = JSON.parse(data);
      initUser(socket.request.user.userid, obj.lat, obj.lon, socket.id).then(() => {
//      client.set(socket.request.user.userid, socket.request.user.userid, [obj.lat, obj.lon]).then(() => {
        console.log("initializing...");
      }).catch(err => {
        console.error(err);
      });
    });
    const session = socket.request.session;
    console.log(`saving sid ${socket.id} in session ${session.id}`);
    session.socketId = socket.id;
    session.save();
  });



//app.listen(PORT, () => {
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Application server started on port: ${PORT}`)
})
//app.listen(PORT, () => {
    httpsServer.listen(3001, '0.0.0.0', () => {
        console.log(`Application server started on port: 3001`)
})

async function initUser(userid, lat, lon, socket_id) {
  const dbclient = await pool.connect();
  try {
    await dbclient.query('BEGIN')
    const accData = await dbclient.query('SELECT poi_id, name, ST_AsGeoJson(a.geog) coords FROM poilloi_data a WHERE ST_DWithin(a.geog, ST_MakePoint($1, $2), 10000);', [lon, lat]);
    accData.rows.forEach(row => {

      client.executeCommand('SET ' + userid + ' ' + row.poi_id + ' OBJECT ' + row.coords ).then(() => {
         console.log("added feature " + row.name + ' at ' + row.coords + ' for user ' + userid + ' on socket ' + socket_id);
        io.to(socket_id).emit("poi_list",{name: row.name, coords: row.coords, poi_id: row.poi_id});
      }).catch(err => {
        console.error(err);
      });
    });

  }
  catch(e) {
      throw (e)
  }
}