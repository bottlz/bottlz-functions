require("dotenv").config();
const maps = require("azure-maps-rest");


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
    var coordinates = [startPoint.coordinates, endPoint.coordinates];

    //TODO: add better error handling when route can't be generated
    return await routeURL.calculateRouteDirections(maps.Aborter.timeout(10000), coordinates).then((directions) => {
        var route = directions.geojson.getFeatures();
        return { "distance": extractRouteLength(route), "route": extractRoute(route) };
    });
}

/**
 * 
 * @returns Random number between -0.01 and 0.01
 */
function offset() {
    var offset = Math.random();
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
    var lon = origin.coordinates[0] + offset();
    var lat = origin.coordinates[1] + offset();
    var radius = 500; // radius in meters to search in

    return await searchURL.searchNearby(maps.Aborter.timeout(10000), [lon, lat], {
        limit: 1,
        radius: radius
    }).then((results) => {
        var data = results.geojson.getFeatures();
        return data.features[0].geometry;
    });
}


module.exports = async function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request.');

    const bottleId = req.body && req.body.id;
    const created = req.body && req.body.created;
    const origin = req.body && req.body.origin;
    const endpoint = req.body && req.body.endpoint;
    var routes = req.body && req.body.routes;

    if (!bottleId || !origin || !endpoint || !created || !routes) {
        context.res = {
            status: 400,
            body: 'Missing required inputs to route function.'
        };
        return;
    }

    var pipeline = maps.MapsURL.newPipeline(new maps.SubscriptionKeyCredential(process.env.MAPS_SUB_KEY));
    var routeURL = new maps.RouteURL(pipeline);
    var searchURL = new maps.SearchURL(pipeline);

    var newEndpt;
    if (routes.length == 0) {
        // No routes have been generated yet, generate two starting at origin
        var endpt1 = await getRandomEndpoint(origin, searchURL);
        var route1 = await getRoute(origin, endpt1, routeURL);
        newEndpt = await getRandomEndpoint(origin, searchURL);
        var route2 = await getRoute(endpt1, newEndpt, routeURL);
        routes.push(route1, route2);
    } else {
        // Only generate one new route
        newEndpt = await getRandomEndpoint(origin, searchURL);
        var route1 = await getRoute(endpoint, newEndpt, routeURL);
        routes.push(route1);
    }

    context.bindings.outputDocument = JSON.stringify({
        id: bottleId,
        created: created,
        origin: origin,
        endpoint: newEndpt,
        routes: routes
    });

    context.res = {
        status: 200, /* Defaults to 200 */
        body: 'Successfully generated route for bottle ' + bottleId + '.'
    };
}