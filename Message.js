import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema({
  isPrivate: { type: Boolean, default: false },
  participants: { type: [String], default: [] }, // for private messages
  room: { type: String, default: null },
  user: { type: String, required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

export default mongoose.model("Message", MessageSchema);
