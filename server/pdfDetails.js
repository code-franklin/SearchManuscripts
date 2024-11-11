const mongoose = require("mongoose");

const AdvisorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  specializations: [String], // Array of specializations for the advisor
  panelistRole: { type: String, required: true } // Role of the panelist (e.g., Subject Expert, Statistician, Technical Expert)
});

const Advisor = mongoose.model("Advisor", AdvisorSchema);

module.exports = Advisor;
