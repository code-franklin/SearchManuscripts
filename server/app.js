const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require('body-parser');

const cors = require("cors");
const multer = require("multer");
const { LanguageServiceClient } = require("@google-cloud/language"); // Import Google Language API

const app = express();

// Middleware setup
app.use(express.json());
app.use(cors());
app.use("/files", express.static("files"));

// MongoDB connection
const mongoUrl = "mongodb+srv://frankelinmayad:code-franklin2410@pdfuploader.oz6oo.mongodb.net/pdfDatabase?retryWrites=true&w=majority&appName=pdfuploader&ssl=true";

mongoose
  .connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Initialize Google Cloud Language client
const client = new LanguageServiceClient({
    // If you have an API key, you can provide it here
    apiKey: 'AIzaSyBqx-4PSSfP-vZBhBBgmu4uxmftsHLfTfE',
});

// Define storage configuration for multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./files");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now();
    cb(null, uniqueSuffix + file.originalname);
  },
});

// Synonym Schema
const synonymSchema = new mongoose.Schema({
  term: { type: String, required: true },
  synonyms: [String],
});

const Synonym = mongoose.model('Synonym', synonymSchema);

// POST route to add new synonyms
app.post('/api/synonyms', async (req, res) => {
  const { term, synonyms } = req.body;

  if (!term || !synonyms) {
    return res.status(400).json({ message: 'Both term and synonyms are required.' });
  }

  try {
    let synonymEntry = await Synonym.findOne({ term });

    if (synonymEntry) {
      // If term already exists, update synonyms
      synonymEntry.synonyms = Array.from(new Set([...synonymEntry.synonyms, ...synonyms]));
      await synonymEntry.save();
    } else {
      // Otherwise, create a new entry
      synonymEntry = new Synonym({ term, synonyms });
      await synonymEntry.save();
    }

    res.status(201).json({ message: 'Synonyms added successfully', data: synonymEntry });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

app.get('/api/synonyms/:term', async (req, res) => {
  try {
    const { term } = req.params;
    const synonymEntry = await Synonym.findOne({ term });

    if (synonymEntry) {
      res.json(synonymEntry.synonyms);
    } else {
      res.status(404).json({ message: 'No synonyms found for this term' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Helper function to get synonyms for entities
async function expandEntitiesWithSynonyms(entities) {
  const expandedTerms = new Set();

  for (const term of entities) {
    expandedTerms.add(term); // Include the original term
    const synonymEntry = await Synonym.findOne({ term }); // Check if synonyms exist in your database
    if (synonymEntry) {
      synonymEntry.synonyms.forEach((synonym) => expandedTerms.add(synonym));
    }
  }

  return Array.from(expandedTerms); // Convert Set to array to remove duplicates
}

app.post("/search", async (req, res) => {
  const { query } = req.body;

  if (!query) {
    return res.status(400).send("Query is required for search.");
  }

  try {
    // Step 1: Analyze entities using Google NLP to identify terms
    const document = {
      content: query,
      type: "PLAIN_TEXT",
    };
    const [result] = await client.analyzeEntities({ document });
    const entities = result.entities.map(entity => entity.name.toLowerCase());

    console.log("Identified entities:", entities);

    // Step 2: Expand entities with synonyms
    const expandedQueryTerms = await expandEntitiesWithSynonyms(entities); // Await here
    console.log("Expanded search terms:", expandedQueryTerms);

    // Step 3: Perform a search in MongoDB with the expanded terms
    const searchResults = await PdfSchema.find({
      $or: [
        { keywords: { $in: expandedQueryTerms } },
        { title: { $regex: expandedQueryTerms.join("|"), $options: "i" } },
        { authors: { $regex: expandedQueryTerms.join("|"), $options: "i" } }
      ]
    });

    if (searchResults.length > 0) {
      return res.status(200).json({
        status: "ok",
        results: searchResults,
      });
    } else {
      return res.status(404).json({ status: "not found", message: "No documents found." });
    }
  } catch (error) {
    console.error("Error with Google NLP or searching documents:", error);
    return res.status(500).send("Error analyzing or searching documents.");
  }
});
// Import your PDF schema
require("./pdfDetails"); // Ensure you have a correct schema in pdfDetails.js
const PdfSchema = mongoose.model("PdfDetails");
const upload = multer({ storage: storage });

// Route to upload files
app.post("/upload-files", upload.single("file"), async (req, res) => {
  const { title, authors, dateUploaded, datePublished } = req.body;
  const fileName = req.file.filename;

  try {
    await PdfSchema.create({
      title,
      authors,
      dateUploaded,
      datePublished,
      pdf: fileName,
    });
    res.send({ status: "ok" });
  } catch (error) {
    res.json({ status: error.message });
  }
});

// Route to get all files
app.get("/get-files", async (req, res) => {
  try {
    const data = await PdfSchema.find({});
    res.send({ status: "ok", data });
  } catch (error) {
    res.json({ status: error.message });
  }
});

// Route to analyze text using Google NLP
app.post("/analyze", async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).send("Text is required for analysis.");
  }

  try {
    const document = {
      content: text,
      type: "PLAIN_TEXT",
    };

    // Use the Language API to analyze the text
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
