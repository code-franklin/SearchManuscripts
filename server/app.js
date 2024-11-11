// Import necessary packages
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const { LanguageServiceClient } = require("@google-cloud/language");

const app = express();

// Middleware setup
app.use(express.json());
app.use(cors());

// MongoDB connection
const mongoUrl = "mongodb+srv://LSPU:admin@research-management-por.m3kzu45.mongodb.net/ResearchTru?retryWrites=true&w=majority&appName=Research-Management-Portal";

mongoose
  .connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Initialize Google Cloud Language client
const client = new LanguageServiceClient({
  apiKey: 'AIzaSyBqx-4PSSfP-vZBhBBgmu4uxmftsHLfTfE',
});

// Define Advisor Schema
const advisorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  specializations: [String], // Array of specializations for each advisor
  panelistRole: { type: String, required: true } // Role of the panelist (e.g., Subject Expert, Statistician, Technical Expert)
});
const Advisor = mongoose.model("Advisor", advisorSchema);

// Synonym Schema
const synonymSchema = new mongoose.Schema({
  term: { type: String, required: true },
  synonyms: [String],
});
const Synonym = mongoose.model('Synonym', synonymSchema);

// POST route to add a new advisor
app.post('/api/advisors', async (req, res) => {
  const { name, specializations, panelistRole } = req.body;
  if (!name || !specializations || !panelistRole) {
    return res.status(400).json({ message: 'Name, specializations, and panelist role are required.' });
  }

  try {
    const newAdvisor = new Advisor({
      name,
      specializations,
      panelistRole,
    });
    await newAdvisor.save();
    res.status(201).json({ message: 'Advisor added successfully', data: newAdvisor });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// POST route to add new synonyms
app.post('/api/synonyms', async (req, res) => {
  const { term, synonyms } = req.body;
  if (!term || !synonyms) return res.status(400).json({ message: 'Both term and synonyms are required.' });

  try {
    let synonymEntry = await Synonym.findOne({ term });
    if (synonymEntry) {
      synonymEntry.synonyms = Array.from(new Set([...synonymEntry.synonyms, ...synonyms]));
      await synonymEntry.save();
    } else {
      synonymEntry = new Synonym({ term, synonyms });
      await synonymEntry.save();
    }
    res.status(201).json({ message: 'Synonyms added successfully', data: synonymEntry });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Helper function to get synonyms for entities
async function expandEntitiesWithSynonyms(entities) {
  const expandedTerms = new Set();

  for (const term of entities) {
    expandedTerms.add(term.toLowerCase()); // Ensure case-insensitivity by converting to lowercase
    const synonymEntry = await Synonym.findOne({ term: term.toLowerCase() }); // Match case-insensitive
    if (synonymEntry) {
      synonymEntry.synonyms.forEach((synonym) => expandedTerms.add(synonym.toLowerCase())); // Ensure case-insensitive
    }
  }

  return Array.from(expandedTerms); // Convert Set to array to remove duplicates
}

// Route to get random panelists based on selected advisor
app.post('/api/get-panelists', async (req, res) => {
  const { advisorId } = req.body; // Get the selected advisor's ID

  if (!advisorId) {
    return res.status(400).json({ message: 'Advisor ID is required.' });
  }

  try {
    // Get the selected advisor based on advisorId
    const selectedAdvisor = await Advisor.findById(advisorId);
    
    if (!selectedAdvisor) {
      return res.status(404).json({ message: 'Advisor not found.' });
    }

    // Fetch all advisors and shuffle them to pick 3 random ones for panelists
    const allAdvisors = await Advisor.find({}).exec();
    
    // Filter out the selected advisor from the list to avoid assigning them as a panelist
    const filteredAdvisors = allAdvisors.filter(advisor => advisor._id.toString() !== advisorId);
    
    // Shuffle the advisors and pick 3 random ones
    const shuffledAdvisors = filteredAdvisors.sort(() => 0.5 - Math.random()).slice(0, 3);

    // Prepare the panelists list with their roles
    const panelists = shuffledAdvisors.map(advisor => ({
      name: advisor.name,
      role: advisor.panelistRole,
    }));

    // Send the panelists back to the frontend
    return res.status(200).json({ panelists });

  } catch (error) {
    console.error("Error getting panelists:", error);
    res.status(500).send("Error retrieving panelists.");
  }
});


app.post("/search", async (req, res) => {
  const { query } = req.body;

  // Ensure query is provided
  if (!query || query.length === 0) {
    return res.status(400).send("Query is required for search.");
  }

  try {
    // Function to escape special characters in the query terms
    const escapeRegex = (text) => text.replace(/[.*+?^=!:${}()|\[\]\/\\]/g, "\\$&");

    // Split the query into terms and expand with synonyms (assuming this function exists)
    const expandedQueryTerms = await expandEntitiesWithSynonyms(query);
    console.log('Expanded Query Terms:', expandedQueryTerms); // Log expanded terms for debugging

    // Escape query terms for use in regex
    const escapedQueryTerms = expandedQueryTerms.map(term => escapeRegex(term));

    // Search advisors based on specializations using the expanded terms and case-insensitive matching
    const advisors = await Advisor.find({
      specializations: { $in: escapedQueryTerms.map(term => new RegExp(term, 'i')) }
    });

    // If no advisors are found, return an appropriate message
    if (advisors.length === 0) {
      return res.status(404).json({ status: "not found", message: "No advisors found matching specializations." });
    }

    // Calculate match percentage for each advisor
    const advisorsWithMatchPercentage = advisors.map(advisor => {
      // Ensure specializations exist before processing
      if (!advisor.specializations || !Array.isArray(advisor.specializations)) {
        return { advisor, matchPercentage: 0 }; // No match if specializations is missing
      }

      // Count how many of the query terms match with the advisor's specializations
      const matchedSpecializations = advisor.specializations.filter(specialization =>
        escapedQueryTerms.some(term => new RegExp(term, 'i').test(specialization))
      );

      // Calculate the percentage of matched specializations
      const matchPercentage = (matchedSpecializations.length / escapedQueryTerms.length) * 100;

      return {
        advisor,
        matchPercentage,
        specializations: advisor.specializations // Ensure specializations are included
      };
    });

    // Sort advisors by match percentage in descending order
    advisorsWithMatchPercentage.sort((a, b) => b.matchPercentage - a.matchPercentage);

    // Return only the top 3 advisors
    const top3Advisors = advisorsWithMatchPercentage.slice(0, 3);

    // Send the response with the top advisors and their match percentages
    return res.status(200).json({
      status: "ok",
      results: top3Advisors.map(item => ({
        advisor: item.advisor,
        matchPercentage: item.matchPercentage.toFixed(2), // Optional: Round the percentage
        specializations: item.specializations // Include specializations
      }))
    });

  } catch (error) {
    console.error("Error searching advisors:", error);
    return res.status(500).send("Error analyzing or searching advisors.");
  }
});

// Route to analyze text using Google NLP
app.post("/analyze", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).send("Text is required for analysis.");

  try {
    const document = { content: text, type: "PLAIN_TEXT" };
    const [result] = await client.analyzeSentiment({ document });
    res.status(200).json({
      sentimentScore: result.documentSentiment.score,
      sentimentMagnitude: result.documentSentiment.magnitude,
    });
  } catch (error) {
    console.error("Error analyzing text:", error);
    res.status(500).send("Error analyzing text.");
  }
});

// Start the server
app.listen(5000, () => {
  console.log("Server started on port 5000");
});
