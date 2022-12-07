const axios = require("axios");

module.exports = async function (context, mySbMsg) {
  const ROUTE_FUNCTION_URL =
    "https://route-function.azurewebsites.net/api/route-function";
  const bottleData = JSON.parse(mySbMsg);
  context.log(
    "Retriggering route function for bottle id " + bottleData.id + "."
  );
  axios.post(ROUTE_FUNCTION_URL, bottleData);
};
