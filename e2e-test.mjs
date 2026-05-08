#!/usr/bin/env node

/**
 * E2E Tests for Streambin
 * Tests Node.js SDK and CURL commands against production API
 */

import { StreambinClient } from "./packages/sdk/dist/index.js";
import { execSync } from "child_process";
import crypto from "crypto";

const BASE_URL = "https://streambin.xyz";
const TEST_NAMESPACE = `test-${crypto.randomUUID().slice(0, 8)}`;
const TEST_PASSPHRASE = crypto.randomBytes(24).toString("base64url");

console.log("🧪 Streambin E2E Tests");
console.log("======================\n");
console.log(`Base URL: ${BASE_URL}`);
console.log(`Test Namespace: ${TEST_NAMESPACE}`);
console.log(`Test Passphrase: ${TEST_PASSPHRASE}\n`);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ ${message}`);
    passed++;
  } else {
    console.error(`❌ ${message}`);
    failed++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Test 1: Node.js SDK - Stream Operations
async function testNodeSDKStreams() {
  console.log("\n📦 Test 1: Node.js SDK - Stream Operations");
  console.log("-------------------------------------------");

  const client = new StreambinClient({
    baseUrl: BASE_URL,
    namespace: TEST_NAMESPACE,
    passphrase: TEST_PASSPHRASE,
  });

  // Send messages
  await client.appendMessage("test/stream", "Hello from E2E test");
  assert(true, "Sent message to stream");

  await client.appendMessage("test/stream", JSON.stringify({ type: "test", timestamp: Date.now() }));
  assert(true, "Sent JSON message to stream");

  // Get messages
  await sleep(2000); // Allow propagation
  const events = await client.getStream("test/stream", { limit: 10 });
  console.log(`   DEBUG: Retrieved ${events.length} events`);
  if (events.length > 0) {
    console.log(`   DEBUG: First event:`, events[0]);
  }
  assert(events.length >= 2, `Retrieved ${events.length} messages from stream`);
  assert(events[0].value === "Hello from E2E test", "First message matches");
  const secondMsg = typeof events[1].value === "string" ? JSON.parse(events[1].value) : events[1].value;
  assert(typeof secondMsg === "object" && secondMsg.type === "test", "Second message is JSON object");

  // Listen to stream (test SSE)
  let receivedCount = 0;
  const stopListening = client.listenStream("test/live", (message) => {
    receivedCount++;
  });

  await sleep(500); // Wait for connection
  await client.appendMessage("test/live", "Live message 1");
  await client.appendMessage("test/live", "Live message 2");
  await sleep(1000); // Wait for SSE delivery

  stopListening();
  assert(receivedCount >= 2, `Received ${receivedCount} live messages via SSE`);
}

// Test 2: Node.js SDK - Document Operations
async function testNodeSDKDocs() {
  console.log("\n📄 Test 2: Node.js SDK - Document Operations");
  console.log("----------------------------------------------");

  const client = new StreambinClient({
    baseUrl: BASE_URL,
    namespace: TEST_NAMESPACE,
    passphrase: TEST_PASSPHRASE,
  });

  // Set object
  await client.setObject("test/doc", { status: "created", version: 1 });
  assert(true, "Created document");

  // Get object
  const doc = await client.getObject("test/doc");
  assert(doc.status === "created", "Retrieved document matches");
  assert(doc.version === 1, "Document version is correct");

  // Update object (patch)
  await client.updateObject("test/doc", { "status": "updated", "meta.timestamp": Date.now() });
  const updated = await client.getObject("test/doc");
  assert(updated.status === "updated", "Document was patched");
  assert(updated.version === 1, "Original fields preserved");
  assert(updated.meta?.timestamp > 0, "Nested field added");

  // Listen to object changes
  let changeCount = 0;
  const stopWatching = client.listenObject("test/watched", (value) => {
    changeCount++;
  });

  await sleep(500);
  await client.setObject("test/watched", { count: 1 });
  await sleep(500);
  await client.updateObject("test/watched", { count: 2 });
  await sleep(1000);

  stopWatching();
  assert(changeCount >= 2, `Detected ${changeCount} object changes`);

  // Remove object
  await client.removeObject("test/doc");
  const deleted = await client.getObject("test/doc");
  assert(deleted === null, "Document was deleted");
}

// Test 3: CURL Commands
async function testCURLCommands() {
  console.log("\n🌐 Test 3: CURL Commands");
  console.log("------------------------");

  const streamPath = "test/curl-stream";
  const docPath = "test/curl-doc";

  // Helper to encrypt (simplified - matches CURL example)
  function encrypt(data) {
    const payload = typeof data === "string" ? JSON.stringify({ t: "m", d: data }) : JSON.stringify(data);
    return execSync(
      `echo '${payload}' | openssl enc -aes-256-cbc -pbkdf2 -pass pass:"${TEST_PASSPHRASE}" -base64 -A`,
      { encoding: "utf-8" }
    ).trim();
  }

  // Helper to decrypt
  function decrypt(ciphertext) {
    return execSync(
      `echo "${ciphertext}" | openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:"${TEST_PASSPHRASE}" -base64 -A`,
      { encoding: "utf-8" }
    );
  }

  // POST to stream
  const encrypted = encrypt("Hello from CURL");
  execSync(
    `curl -sS -X POST "${BASE_URL}/api/streams/${TEST_NAMESPACE}/${streamPath}" --data-binary '${encrypted}'`,
    { encoding: "utf-8" }
  );
  assert(true, "Posted encrypted message via CURL");

  // GET from stream
  await sleep(500);
  const response = execSync(
    `curl -sS "${BASE_URL}/api/streams/${TEST_NAMESPACE}/${streamPath}?limit=10"`,
    { encoding: "utf-8" }
  );
  const data = JSON.parse(response);
  assert(data.events.length >= 1, `Retrieved ${data.events.length} events via CURL`);

  const decrypted = decrypt(data.events[0].string);
  const parsed = JSON.parse(decrypted);
  assert(parsed.d === "Hello from CURL", "Decrypted message matches");

  // POST doc
  const docData = encrypt({ curl: "test", timestamp: Date.now() });
  execSync(
    `curl -sS -X POST "${BASE_URL}/api/docs/${TEST_NAMESPACE}/${docPath}" --data-binary '${docData}'`,
    { encoding: "utf-8" }
  );
  assert(true, "Posted document via CURL");

  // GET doc
  const docResponse = execSync(
    `curl -sS "${BASE_URL}/api/docs/${TEST_NAMESPACE}/${docPath}"`,
    { encoding: "utf-8" }
  );
  const decryptedDoc = JSON.parse(decrypt(docResponse.trim()));
  assert(decryptedDoc.curl === "test", "Retrieved document via CURL matches");

  // DELETE doc
  execSync(
    `curl -sS -X DELETE "${BASE_URL}/api/docs/${TEST_NAMESPACE}/${docPath}"`,
    { encoding: "utf-8" }
  );
  const deletedResponse = execSync(
    `curl -sS -w "%{http_code}" -o /dev/null "${BASE_URL}/api/docs/${TEST_NAMESPACE}/${docPath}"`,
    { encoding: "utf-8" }
  );
  assert(deletedResponse === "404", "Document deleted via CURL");
}

// Test 4: Plain HTTP (unencrypted)
async function testPlainHTTP() {
  console.log("\n🔓 Test 4: Plain HTTP (Unencrypted)");
  console.log("------------------------------------");

  const streamPath = "test/plain-stream";
  const docPath = "test/plain-doc";

  // POST plain text to stream
  execSync(
    `curl -sS -X POST "${BASE_URL}/api/streams/${TEST_NAMESPACE}/${streamPath}" -d "Plain text message"`,
    { encoding: "utf-8" }
  );
  assert(true, "Posted plain text message");

  // GET from stream
  await sleep(500);
  const response = execSync(
    `curl -sS "${BASE_URL}/api/streams/${TEST_NAMESPACE}/${streamPath}?limit=10"`,
    { encoding: "utf-8" }
  );
  const data = JSON.parse(response);
  assert(data.events.length >= 1, "Retrieved plain text message");
  assert(data.events[0].string === "Plain text message", "Plain text matches");

  // POST plain JSON doc
  execSync(
    `curl -sS -X POST "${BASE_URL}/api/docs/${TEST_NAMESPACE}/${docPath}" -H "Content-Type: application/json" -d '{"plain":"json"}'`,
    { encoding: "utf-8" }
  );
  assert(true, "Posted plain JSON document");

  // GET plain doc
  const docResponse = execSync(
    `curl -sS "${BASE_URL}/api/docs/${TEST_NAMESPACE}/${docPath}"`,
    { encoding: "utf-8" }
  );
  const docData = JSON.parse(docResponse);
  assert(docData.plain === "json", "Retrieved plain JSON document");
}

// Run all tests
async function runTests() {
  try {
    await testNodeSDKStreams();
    await testNodeSDKDocs();
    await testCURLCommands();
    await testPlainHTTP();

    console.log("\n" + "=".repeat(50));
    console.log(`✅ Tests Passed: ${passed}`);
    console.log(`❌ Tests Failed: ${failed}`);
    console.log("=".repeat(50));

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Test suite failed:");
    console.error(error.message);
    console.log("\n" + "=".repeat(50));
    console.log(`✅ Tests Passed: ${passed}`);
    console.log(`❌ Tests Failed: ${failed}`);
    console.log("=".repeat(50));
    process.exit(1);
  }
}

runTests();
