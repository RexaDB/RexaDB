-- Run while connected as REXADB (APP_USER).
-- Creates a private loopback database link in the current schema.

BEGIN
  EXECUTE IMMEDIATE 'DROP DATABASE LINK rexadb_loopback';
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
/

CREATE DATABASE LINK rexadb_loopback
  CONNECT TO rexadb IDENTIFIED BY "rexadb"
  USING 'localhost:1521/FREEPDB1';
