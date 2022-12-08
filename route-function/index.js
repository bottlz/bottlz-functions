require("dotenv").config();
const maps = require("azure-maps-rest");
const { ServiceBusClient } = require("@azure/service-bus");
const { CosmosClient } = require("@azure/cosmos");

/**
 *
 * Given a route represented as a GeoJSON FeatureCollection, extracts the array
 * of coordinates storing the route itself.
 * @param {FeatureCollection} route
 * @returns Value stored at route.features[0].geometry.coordinates[0]
 */
function extractRoute(route) {
  return route.features[0].geometry.coordinates[0];
}

/**
 * Given a route represented as a GeoJSON FeatureCollection, extracts its
 * length in meters.
 * @param {FeatureCollection} route
 * @returns
 */
function extractRouteLength(route) {
  return route.features[0].properties.summary.lengthInMeters;
}

/**
 * Generates a route between startPoint and endPoint.
 * @param {GeoJSON.geometry} startPoint
 * @param {GeoJSON.geometry} endPoint
 * @param {RouteURL} routeURL
 * @returns Array of coordinates representing the route between startPoint
 * and endPoint
 */
async function getRoute(startPoint, endPoint, routeURL) {
  //calculateRouteDirections expects coordinates in the order [longitude, latitude]
  const coordinates = [startPoint.coordinates, endPoint.coordinates];

  //TODO: add better error handling when route can't be generated
  return await routeURL
    .calculateRouteDirections(maps.Aborter.timeout(10000), coordinates)
    .then((directions) => {
      const route = directions.geojson.getFeatures();
      return {
        distance: extractRouteLength(route),
        route: extractRoute(route),
      };
    });
}

/**
 *
 * @returns Random number between -0.01 and 0.01
 */
function offset() {
  let offset = Math.random();
  offset *= Math.round(Math.random()) ? 1 : -1;
  offset /= 100;
  return offset;
}

/**
 * Returns a random point within a 500 mile radius of the given origin.
 * @param {Coordinate array} origin
 * @param {SearchURL} searchURL
 */
async function getRandomEndpoint(origin, searchURL) {
  const lon = origin.coordinates[0] + offset();
  const lat = origin.coordinates[1] + offset();
  const radius = 500; // radius in meters to search in

  return await searchURL
    .searchNearby(maps.Aborter.timeout(10000), [lon, lat], {
      limit: 1,
      radius: radius,
    })
    .then((results) => {
      const data = results.geojson.getFeatures();
      return data.features[0].geometry;
    });
}

/**
 * Returns true if bottle with id bottleId is in bottles database container-1, 
 * and false otherwise.
 * @param {string} bottleId 
 * @returns 
 */
async function checkDbForBottle(bottleId) {
  const cosmosClient = new CosmosClient(process.env.CosmosDbConnectionString); //({ dbEndpoint, key });
  const databaseName = `bottles`;
  const containerName = `bottles-container1`;
  const database = cosmosClient.database(databaseName);
  const container = database.container(containerName);

  const querySpec = {
    query: "select * from c where c.id=@bottleId",
    parameters: [
      {
        name: "@bottleId",
        value: bottleId
      }
    ]
  };

  const { resources } = await container.items.query(querySpec).fetchAll();
  return (resources.length != 0);
}

module.exports = async function (context, req) {
  context.log("JavaScript HTTP trigger function processed a request.");

  const bottleId = req.body && req.body.id;
  const created = req.body && req.body.created;
  const origin = req.body && req.body.origin;
  const endpoint = req.body && req.body.endpoint;
  const routes = req.body && req.body.routes;

  if (!bottleId || !origin || !endpoint || !created || !routes) {
    context.res = {
      status: 400,
      body: {
        error: "Missing required inputs to route function.",
      },
    };
    return;
  }

  //if bottleId is not in DB, terminate
  const bottleInDb = await checkDbForBottle(bottleId);
  if (!bottleInDb) {
    context.res = {
      status: 200,
      body: "Bottle is not in database. Terminating route function.",
    };
    return;
  }

  try {
    const pipeline = maps.MapsURL.newPipeline(
      new maps.SubscriptionKeyCredential(process.env.MAPS_SUB_KEY)
    );
    const routeURL = new maps.RouteURL(pipeline);
    const searchURL = new maps.SearchURL(pipeline);

    let retriggerTime;
    const newEndpoint = await getRandomEndpoint(origin, searchURL);
    if (routes.length == 0) {
      // No routes have been generated yet, generate two starting at origin
      const firstEndpoint = await getRandomEndpoint(origin, searchURL);
      const route1 = await getRoute(origin, firstEndpoint, routeURL);
      retriggerTime = route1.distance * 1000;
      const route2 = await getRoute(firstEndpoint, newEndpoint, routeURL);
      routes.push(route1, route2);
    } else {
      // Only generate one new route
      const route = await getRoute(endpoint, newEndpoint, routeURL);
      retriggerTime = routes[routes.length - 1].distance * 1000;
      routes.push(route);
    }

    const bottleData = {
      id: bottleId,
      created,
      origin,
      endpoint: newEndpoint,
      routes,
    };

    const connectionString = process.env.bottlzbus_SERVICEBUS;
    const queueName = "retrigger-queue";
    const sbClient = new ServiceBusClient(connectionString);
    const sender = sbClient.createSender(queueName);
    const message = { body: JSON.stringify(bottleData) };
    const scheduledEnqueueTimeUtc = new Date(Date.now() + retriggerTime); //delay in milliseconds
    await sender.scheduleMessages(message, scheduledEnqueueTimeUtc);

    context.log(
      "Scheduled retrigger for bottle id " +
      bottleId +
      " in " +
      retriggerTime / 1000 +
      " seconds."
    );

    const jsonBottleData = JSON.stringify(bottleData);
    context.bindings.outputDocument = jsonBottleData;
    context.bindings.actions = {
      actionName: "sendToAll",
      data: jsonBottleData,
      dataType: "json",
    };

    context.res = {
      status: 200,
      body: bottleData,
    };
  } catch (err) {
    context.res = {
      status: 500,
      body: {
        error: err.message,
      },
    };
  }
};
