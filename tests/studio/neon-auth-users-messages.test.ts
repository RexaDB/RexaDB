import test from "node:test";
import assert from "node:assert/strict";
import {
  neonUsersEmptyMessage,
  neonUsersStatusMessage,
} from "@/components/studio/auth/neon-auth-users-messages";
import { AUTH_USERS_LIMIT } from "@/components/studio/auth/users-constants";

test("neonUsersEmptyMessage reports an empty project when no filter is active", () => {
  const message = neonUsersEmptyMessage({ search: "", status: "all" });

  assert.equal(message.title, "No users in your project");
  assert.match(message.description, /no users who signed up/);
});

test("neonUsersEmptyMessage names the status filter that emptied the list", () => {
  const message = neonUsersEmptyMessage({ search: "", status: "unverified" });

  assert.equal(message.title, "No unverified users");
  assert.match(message.description, /no unverified users in your project/);
  assert.match(message.description, /Change the status filter/);
});

test("neonUsersEmptyMessage names the search filter that emptied the list", () => {
  const message = neonUsersEmptyMessage({ search: "  ada  ", status: "all" });

  assert.equal(message.title, "No users found");
  assert.match(message.description, /filters applied/);
});

test("neonUsersEmptyMessage keeps the filter wording when search and status combine", () => {
  const message = neonUsersEmptyMessage({ search: "ada", status: "verified" });

  assert.equal(message.title, "No users found");
  assert.match(message.description, /filters applied/);
});

test("neonUsersStatusMessage counts the visible users", () => {
  const message = neonUsersStatusMessage({
    error: null,
    loading: false,
    filteredCount: 3,
    totalCount: 12,
    limitReached: false,
  });

  assert.equal(message.text, "Showing 3 of 12 users");
  assert.equal(message.tone, "muted");
  assert.equal(message.notice, null);
});

test("neonUsersStatusMessage keeps the refresh error visible next to the retained rows", () => {
  const message = neonUsersStatusMessage({
    error: "connection refused",
    loading: false,
    filteredCount: 3,
    totalCount: 12,
    limitReached: false,
  });

  assert.equal(message.text, "Unable to refresh users: connection refused");
  assert.equal(message.tone, "error");
});

test("neonUsersStatusMessage reports the refresh in flight", () => {
  const message = neonUsersStatusMessage({
    error: null,
    loading: true,
    filteredCount: 3,
    totalCount: 12,
    limitReached: false,
  });

  assert.equal(message.text, "Refreshing users…");
  assert.equal(message.tone, "muted");
});

test("neonUsersStatusMessage warns that older accounts are not loaded", () => {
  const message = neonUsersStatusMessage({
    error: null,
    loading: false,
    filteredCount: AUTH_USERS_LIMIT,
    totalCount: AUTH_USERS_LIMIT,
    limitReached: true,
  });

  assert.equal(message.notice, `Showing the ${AUTH_USERS_LIMIT} most recent users`);
});
