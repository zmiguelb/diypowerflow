//*********************
// BASIC configuration
const mqtt_host = "192.168.1.2";
const influx_host = "192.168.1.100";

//**********************************************
// Solar prediction configuration
// for this to work, you must enter correct values for your location and panel configuration
// Sobreda 38.644943, -9.176978
const latitude = 38.644943; 
const longitude = -9.176978;
const msl = 35; // Mean sea level (in meters)
//
const panels_cfg = [
        // azimuth: in degrees (direction along the horizon, measured from south to west), e.g. 0 is south and 90 is west
        // angle: angle the panels are facing relative to the horizon in degrees, e.g. 0 they are vertical, 90 they are flat
        // wattPeak: the Wp of the panels
        {
            name: 'Roof',
            azimuth: 8,
            angle: 45,
            wattPeak: 4500
           }
        ];
// API key for darksky.net, in order to use aditionally forecasr from darksky.net you need to get and enter an API key
const darkskyApi = '';

// the final calculated prediction will use weighted average from yr and darksky
// these are the weights for each forecast service, the sum should be 1.0
// adjust to fit which service better forecasts your location
//
const yr_weight = 1.0;
const darsksky_weight = 0.0;


//**************************************************

var solar_kwh = 0;
var house_kwh = 0;
var grid_imp_kwh = 0;
var grid_exp_kwh = 0.0;

//**************************************************
// MQTT watt topics
const house_watt_topic = 'powerflow/house/watt';
const house_kwh_topic = 'powerflow/house/kwh';
const house2_watt_topic = 'house2/watt';
const grid_watt_topic = 'powerflow/grid/watt';
const grid_imp_kwh_topic = 'powerflow/grid/imp_kwh';
const grid_exp_kwh_topic = 'powerflow/grid/exp_kwh';
const powerwall_watt_topic = 'powerwall/watt';
const solar_watt_topic = "powerflow/solar/watt";
const solar_kwh_topic = "powerflow/solar/kwh";


//**************************************************
//**************************************************

const express = require('express')
const app = express()

const diy_sun = require('./diy_sun');

const mqtt = require('mqtt')
const mqtt_client = mqtt.connect('mqtt://'+mqtt_host);

const Influx = require('influx')
const influx = new Influx.InfluxDB({
  host: influx_host,
  database: 'efergy'
})

const influx_batrium = new Influx.InfluxDB({
  host: influx_host,
  database: 'meter'
})


var moment = require('moment');
var schedule = require('node-schedule');


var house = 0;
var house2 = 0;
var grid = 0;
var powerwall = 0;
var solar = 0;
var solar_prediction = 0;
var solar_prediction_dayOffset = 0;

var server = require('http').createServer(app);
var io = require('socket.io')(server);
var SunCalc = require('suncalc');

function emitSolarPrediction() {
    prefix = "";

    if (solar_prediction_dayOffset>0) {
        prefix = "tomorrow ";
    }

    io.emit('solar prediction', { message: "("+prefix+"prediction "+solar_prediction.toPrecision(2)+" kWh)" });
}

function calculateSolarPrediction() {
    return diy_sun.solar_prediction_kwh( panels_cfg, solar_prediction_dayOffset, latitude, longitude, msl, darkskyApi, yr_weight, darsksky_weight);
}

// schedule every night to recalculate solar prediction for current day and schedule a job for the sunset

var j1 = schedule.scheduleJob('0 2 * * *', function(){

  solar_prediction_dayOffset = 0;
  solar_prediction = calculateSolarPrediction();
  emitSolarPrediction();

  var j2 = schedule.scheduleJob(moment(SunCalc.getTimes(moment(), latitude,longitude).sunset).toDate(), function(){
      // at sunset recalculate solar prediction for tomorrow
      solar_prediction_dayOffset = 1;
      solar_prediction = calculateSolarPrediction();
      emitSolarPrediction();
  });

});


console.log("Calculating solar prediction");
solar_prediction_dayOffset = moment().isAfter(moment(SunCalc.getTimes(moment(), latitude,longitude).sunset))? 1 : 0;
solar_prediction = calculateSolarPrediction();

io.on('connection', function(){
//    console.log("NEW CONNECTION sending all values on start");
    if (house > 0 || house2 > 0) {
        io.emit('house', { message: house+house2 });
    }
    if (powerwall != 0) {
        io.emit('powerwall', { message: powerwall });
    }
    if (grid != 0) {
        io.emit('grid', { message: grid });
    }
    if (solar > 0) {
        io.emit('solar', { message: solar });
    }
    if (solar_prediction > 0) {
        emitSolarPrediction();
    }
});

mqtt_client.on('connect', () => {
//  console.log("MQTT connected");
  mqtt_client.subscribe(house_watt_topic);
  mqtt_client.subscribe(house2_watt_topic);
  mqtt_client.subscribe(grid_watt_topic);
  mqtt_client.subscribe(powerwall_watt_topic);
  mqtt_client.subscribe(solar_watt_topic);
  mqtt_client.subscribe(grid_imp_kwh_topic);
  mqtt_client.subscribe(grid_exp_kwh_topic);
  mqtt_client.subscribe(house_kwh_topic);
  mqtt_client.subscribe(solar_kwh_topic);
})

mqtt_client.on("close",function(error){
   console.log("mqtt can't connect"+error);
   io.emit('house', { message: 0 });
   io.emit('grid', { message: 0 });
   io.emit('powerwall', { message: 0 });
   io.emit('solar', { message: 0 });
 })

mqtt_client.on('message', (topic, message) => {
  if(topic === house_watt_topic) {
       house = parseInt(message.toString())
       io.emit('house', { message: house+house2 });
  } else
  if(topic === powerwall_watt_topic) {
       powerwall = parseInt(message.toString())
       io.emit('powerwall', { message: powerwall });
  } else
  if(topic === grid_watt_topic) {
       grid = parseInt(message.toString())
       io.emit('grid', { message: grid });
  } else
  if(topic === house2_watt_topic) {
       house2 = parseInt(message.toString())
        io.emit('house', { message: house+house2 });
  } else
  if(topic === solar_watt_topic) {
       solar = parseInt(message.toString())
       io.emit('solar', { message: solar });
  } else
  if(topic === grid_imp_kwh_topic) {
       grid_imp_kwh = parseFloat(message.toString())
       io.emit('grid_imp_kwh', { message: grid_imp_kwh });
  }  else
  if(topic === grid_exp_kwh_topic) {
       grid_exp_kwh = parseFloat(message.toString())
       io.emit('grid_exp_kwh', { message: grid_exp_kwh });
  } else
  if(topic === house_kwh_topic) {
       house_kwh = parseFloat(message.toString())
        io.emit('house_kwh', { message: house_kwh });
  } else
  if(topic === solar_kwh_topic) {
       solar_kwh = parseFloat(message.toString())
       io.emit('solar_kwh', { message: solar_kwh });
  }
})

app.get('/energy', function (req, res) {
    res.json(
      [
          {"name":"grid kwh","value": grid_imp_kwh},
          {"name":"house kwh","value":house_kwh},
          {"name":"solar kwh","value": solar_kwh},
          {"name":"grid exp","value": grid_exp_kwh}
      ]
      
      );
      
})

/*
app.get('/soc', function (req, res) {
  influx_batrium.query(powerwall_soc_query).then( soc => {
    res.json(
        [
            {"name":"powerwall soc","value":soc[0].last}
        ]
        );
  });
})
*/

app.get('/soc', function (req, res) {
    res.json(
        [
            {"name":"powerwall soc","value":"50"}
        ]
        );
})


app.use('/powerflow',express.static('static'))


server.listen( 3333 , () => console.log('DIY powerflow listening on port 3333!'))

