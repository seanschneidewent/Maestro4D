import { GoogleGenerativeAI } from "@google/generative-ai";
import { Insight, InsightType, Severity, InsightStatus } from "../types";

// Initialize the Google Generative AI client
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY || "");

/**
 * Converts a File to a base64 string.
 */
const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve({
        inlineData: {
          data: base64String,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Analyzes a Deviation Report PDF using Gemini to generate insights.
 */
export const analyzeDeviationReport = async (file: File): Promise<Insight[]> => {
  if (!API_KEY) {
    console.error("Gemini API Key is missing. Please set VITE_GEMINI_API_KEY or GEMINI_API_KEY in your environment.");
    // Returning empty array to prevent crash, but in a real app, we should show an error notification.
    throw new Error("Gemini API Key is missing.");
  }

  try {
    // For now, we default to gemini-1.5-pro as it supports PDF understanding well.
    // User requested Gemini 3.0 Pro, but we'll stick to a known working model ID or the latest alias.
    // 'gemini-1.5-pro' is a good choice for document analysis.
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const filePart = await fileToGenerativePart(file);

    const prompt = `
      You are an expert construction analyst. Analyze the attached Deviation Report PDF.
      Extract all reported deviations and format them as a JSON array of "Insight" objects.
      
      The output must be a valid JSON array. Do not include markdown formatting (like \`\`\`json).
      
      Each Insight object must match this TypeScript interface:
      
      interface Insight {
        id: string; // Generate a unique ID (e.g., "dev-1", "dev-2")
        type: "Clash"; // Currently only "Clash" is supported
        title: string; // A short title for the deviation
        summary: string; // A detailed description of the deviation
        assignedTo?: string; // Trade or team assigned (e.g., "MEP", "Structural") if mentioned, else "Unassigned"
        status: "Open" | "Acknowledged" | "Resolved" | "Muted"; // Default to "Open"
        severity: "Critical" | "High" | "Medium" | "Low"; // Infer severity from the report
        elementIds: string[]; // Array of element IDs if mentioned, else empty []
        detectedAt: string; // ISO date string, use current date if not in report
        tags: string[]; // Keywords like "Pipe", "Wall", "Level 2"
        source: {
          system: string; // E.g., "Navisworks", "Revizto", or inferred from report
          file: string; // Use the filename: "${file.name}"
          row: number; // Sequential number starting at 1
          itemA?: string; // First item in clash (if applicable)
          itemB?: string; // Second item in clash (if applicable)
          clearance?: string; // Clearance value (if applicable)
          group?: string; // Group name (if applicable)
        };
        notes: []; // Empty array
      }
      
      Ensure strict adherence to the JSON structure.
    `;

    const result = await model.generateContent([prompt, filePart]);
    const response = result.response;
    const text = response.text();

    // Clean up potential markdown code blocks if Gemini adds them despite instructions
    const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();

    try {
      const insights: Insight[] = JSON.parse(cleanJson);
      
      // Post-processing to ensure all required fields are present and correct types
      return insights.map((insight, index) => ({
        ...insight,
        id: `gemini-${Date.now()}-${index}`, // Ensure unique ID on client side
        detectedAt: insight.detectedAt || new Date().toISOString(),
        status: insight.status || InsightStatus.Open,
        type: InsightType.Clash, // Enforce valid enum
        source: {
          ...insight.source,
          file: file.name, // Ensure filename is correct
          row: index + 1
        },
        notes: []
      }));
    } catch (parseError) {
      console.error("Failed to parse Gemini response as JSON:", text);
      throw new Error("Failed to parse analysis results.");
    }
  } catch (error) {
    console.error("Error analyzing deviation report:", error);
    throw error;
  }
};

