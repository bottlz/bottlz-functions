require("dotenv").config();
const maps = require("azure-maps-rest");

async function getRoute(startPoint, endPoint, routeURL) {
    //Start and end point input to the routeURL
    //calculateRouteDirections expects coordinates in the order [longitude, latitude]
    var coordinates = [[startPoint.coordinates[1], startPoint.coordinates[0]], [endPoint.coordinates[1], endPoint.coordinates[0]]];

    return await routeURL.calculateRouteDirections(maps.Aborter.none, coordinates).then((directions) => {
        return directions.geojson.getFeatures();
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
            body: "Missing required inputs to route function."
        };
        return;
    }

    var pipeline = maps.MapsURL.newPipeline(new maps.SubscriptionKeyCredential(process.env.MAPS_SUB_KEY));
    var routeURL = new maps.RouteURL(pipeline);

    var newEndpt;
    if (routes.length == 0) {
        // No routes have been generated yet, generate two starting at origin
        // TODO: pick actual endpoints
        var endpt1 = {
            "type": "Point",
            "coordinates": [42.445119924722725, -76.49976358014023]
        };
        var route1 = await getRoute(origin, endpt1, routeURL);
        newEndpt = {
            "type": "Point",
            "coordinates": [42.44188967828053, -76.4873610457749]
        };
        var route2 = await getRoute(endpt1, newEndpt, routeURL);
        routes.push(route1, route2);
    } else {
        // Only generate one new route
        newEndpt = {
            "type": "Point",
            "coordinates": [42.445119924722725, -76.49976358014023]
        };
        var route1 = await getRoute(endpoint, newEndpt, routeURL);
        routes.push(route1);
    }

    //TODO: only add part of routes that we actually need to database
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