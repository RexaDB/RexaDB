import java.io.*;
import java.net.*;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;

public class Bridge {
  static final Map<Integer, Session> sessions = new ConcurrentHashMap<>();
  static int nextSessionId = 1;

  public static void main(String[] args) throws Exception {
    BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
    String line;
    while ((line = in.readLine()) != null) {
      if (line.isBlank()) continue;
      handle(line.trim());
    }
    for (Session s : sessions.values()) { try { s.conn.close(); } catch (Exception e) {} }
  }

  static void handle(String json) {
    String id = extractString(json, "reqId");
    if (id == null) id = extractString(json, "id");
    try {
      String action = extractString(json, "action");
      if (action == null) { respond(0, false, "{\"error\":\"no action\"}", id); return; }

      switch (action) {
        case "connect" -> handleConnect(json, id);
        case "query" -> handleQuery(json, id);
        case "schemas" -> handleSchemas(json, id);
        case "tables" -> handleTables(json, id);
        case "structure" -> handleStructure(json, id);
        case "foreign-keys" -> handleForeignKeys(json, id);
        case "disconnect" -> handleDisconnect(json, id);
        default -> respond(0, false, "{\"error\":\"unknown action: " + escape(action) + "\"}", id);
      }
    } catch (Exception e) {
      respond(0, false, errorJson(e), id);
    }
  }

  static void handleConnect(String json, String id) throws Exception {
    String configStr = extractString(json, "config");
    String jdbcUrl = extractString(configStr, "jdbcUrl");
    String driverClass = extractString(configStr, "driverClass");
    String jarPathsStr = extractString(configStr, "jarPaths");
    String username = extractString(configStr, "username");
    String password = extractString(configStr, "password");

    if (jdbcUrl == null) { respond(0, false, "{\"error\":\"no jdbcUrl\"}", id); return; }
    if (driverClass == null) { respond(0, false, "{\"error\":\"no driverClass\"}", id); return; }

    // Parse jarPaths array
    String[] jarPaths = parseJsonArray(jarPathsStr);
    URL[] urls = new URL[jarPaths.length];
    for (int i = 0; i < jarPaths.length; i++) {
      urls[i] = new File(jarPaths[i]).toURI().toURL();
    }

    URLClassLoader loader = new URLClassLoader(urls, Bridge.class.getClassLoader());
    Driver driver = (Driver) Class.forName(driverClass, true, loader).getDeclaredConstructor().newInstance();

    Properties props = new Properties();

    // Try username/password from config first
    if (username != null && !username.isEmpty()) props.setProperty("user", username);
    if (password != null && !password.isEmpty()) props.setProperty("password", password);

    // Fallback: extract user:pass from JDBC URL (libpq format postgresql://user:pass@host:port/db)
    if (!props.containsKey("user") || props.getProperty("user").isEmpty()) {
      try {
        java.net.URI uri = new java.net.URI(jdbcUrl.substring(jdbcUrl.indexOf(':') + 1));
        String userInfo = uri.getUserInfo();
        if (userInfo != null && !userInfo.isEmpty()) {
          String[] parts = userInfo.split(":", 2);
          props.setProperty("user", parts[0]);
          if (parts.length > 1) props.setProperty("password", parts[1]);
          // Remove user:pass from URL
          jdbcUrl = jdbcUrl.replace(userInfo + "@", "");
        }
      } catch (Exception e) {
        // ignore URI parse errors
      }
    }

    Connection conn = driver.connect(jdbcUrl, props);
    if (conn == null) {
      respond(0, false, "{\"error\":\"Driver returned null connection (wrong URL?)\"}", id);
      return;
    }

    int sessionId = nextSessionId++;
    sessions.put(sessionId, new Session(conn, loader));
    respond(sessionId, true, "{}", id);
  }

  static void handleQuery(String json, String id) throws Exception {
    Session s = getSession(json, id);
    if (s == null) return;
    String sql = extractString(json, "sql");
    if (sql == null) { respond(0, false, "{\"error\":\"no sql\"}", id); return; }

    try (Statement stmt = s.conn.createStatement()) {
      boolean isResultSet = stmt.execute(sql);
      if (isResultSet) {
        try (ResultSet rs = stmt.getResultSet()) {
          String result = resultSetToJson(rs);
          respond(0, true, result, id);
        }
      } else {
        int count = stmt.getUpdateCount();
        respond(0, true, "{\"affectedRows\":" + count + ",\"columns\":[],\"rows\":[]}", id);
      }
    } catch (Exception e) {
      respond(0, false, errorJson(e), id);
    }
  }

  static void handleSchemas(String json, String id) throws Exception {
    Session s = getSession(json, id);
    if (s == null) return;
    DatabaseMetaData meta = s.conn.getMetaData();
    StringBuilder rows = new StringBuilder("[");
    boolean first = true;
    try (ResultSet rs = meta.getSchemas()) {
      while (rs.next()) {
        if (!first) rows.append(",");
        rows.append("[\"").append(escape(rs.getString("TABLE_SCHEM"))).append("\"]");
        first = false;
      }
    }
    rows.append("]");
    respond(0, true, "{\"columns\":[{\"name\":\"schema\",\"type\":\"varchar\"}],\"rows\":" + rows + "}", id);
  }

  static void handleTables(String json, String id) throws Exception {
    Session s = getSession(json, id);
    if (s == null) return;
    String schema = extractString(json, "schema");
    if (schema == null || schema.isEmpty()) schema = "%";

    DatabaseMetaData meta = s.conn.getMetaData();
    StringBuilder rows = new StringBuilder("[");
    boolean first = true;
    try (ResultSet rs = meta.getTables(null, schema, "%", new String[]{"TABLE", "VIEW"})) {
      while (rs.next()) {
        if (!first) rows.append(",");
        rows.append("[");
        rows.append("\"").append(escape(rs.getString("TABLE_NAME"))).append("\",");
        rows.append("\"").append(escape(rs.getString("TABLE_TYPE"))).append("\",");
        rows.append("\"").append(escape(rs.getString("TABLE_SCHEM"))).append("\"");
        rows.append("]");
        first = false;
      }
    }
    rows.append("]");
    respond(0, true, "{\"columns\":[{\"name\":\"name\",\"type\":\"varchar\"},{\"name\":\"type\",\"type\":\"varchar\"},{\"name\":\"schema\",\"type\":\"varchar\"}],\"rows\":" + rows + "}", id);
  }

  static void handleStructure(String json, String id) throws Exception {
    Session s = getSession(json, id);
    if (s == null) return;
    String schema = extractString(json, "schema");
    String table = extractString(json, "table");
    if (table == null) { respond(0, false, "{\"error\":\"no table\"}", id); return; }

    DatabaseMetaData meta = s.conn.getMetaData();
    StringBuilder rows = new StringBuilder("[");
    boolean first = true;
    try (ResultSet rs = meta.getColumns(null, schema, table, "%")) {
      while (rs.next()) {
        if (!first) rows.append(",");
        rows.append("[");
        rows.append("\"").append(escape(rs.getString("COLUMN_NAME"))).append("\",");
        rows.append("\"").append(escape(rs.getString("TYPE_NAME"))).append("\",");
        rows.append(rs.getInt("COLUMN_SIZE")).append(",");
        rows.append(rs.getInt("NULLABLE") == DatabaseMetaData.columnNullable ? "true" : "false").append(",");
        rows.append("\"").append(escape(nullToEmpty(rs.getString("COLUMN_DEF")))).append("\",");
        rows.append(rs.getInt("ORDINAL_POSITION"));
        rows.append("]");
        first = false;
      }
    }
    rows.append("]");
    respond(0, true, "{\"columns\":[{\"name\":\"name\",\"type\":\"varchar\"},{\"name\":\"type\",\"type\":\"varchar\"},{\"name\":\"size\",\"type\":\"int\"},{\"name\":\"nullable\",\"type\":\"bool\"},{\"name\":\"default\",\"type\":\"varchar\"}],\"rows\":" + rows + "}", id);
  }

  static void handleForeignKeys(String json, String id) throws Exception {
    Session s = getSession(json, id);
    if (s == null) return;
    String schema = extractString(json, "schema");
    String table = extractString(json, "table");
    if (table == null) { respond(0, false, "{\"error\":\"no table\"}", id); return; }

    DatabaseMetaData meta = s.conn.getMetaData();
    StringBuilder rows = new StringBuilder("[");
    boolean first = true;
    try (ResultSet rs = meta.getImportedKeys(null, schema, table)) {
      while (rs.next()) {
        if (!first) rows.append(",");
        rows.append("[");
        rows.append("\"").append(escape(rs.getString("FKCOLUMN_NAME"))).append("\",");
        rows.append("\"").append(escape(rs.getString("PKTABLE_NAME"))).append("\",");
        rows.append("\"").append(escape(rs.getString("PKTABLE_SCHEM"))).append("\",");
        rows.append("\"").append(escape(rs.getString("PKCOLUMN_NAME"))).append("\",");
        rows.append("\"").append(escape(rs.getString("FK_NAME"))).append("\"");
        rows.append("]");
        first = false;
      }
    }
    rows.append("]");
    respond(0, true, "{\"columns\":[{\"name\":\"fkColumn\",\"type\":\"varchar\"},{\"name\":\"pkTable\",\"type\":\"varchar\"},{\"name\":\"pkColumn\",\"type\":\"varchar\"}],\"rows\":" + rows + "}", id);
  }

  static void handleDisconnect(String json, String id) throws Exception {
    int sessionId = extractInt(json, "session");
    Session s = sessions.remove(sessionId);
    if (s != null) { try { s.conn.close(); } catch (Exception e) {} }
    respond(0, true, "{}", id);
  }

  static Session getSession(String json, String id) {
    int sessionId = extractInt(json, "session");
    Session s = sessions.get(sessionId);
    if (s == null) respond(0, false, "{\"error\":\"invalid session\"}", id);
    return s;
  }

  static String resultSetToJson(ResultSet rs) throws Exception {
    ResultSetMetaData meta = rs.getMetaData();
    int colCount = meta.getColumnCount();

    StringBuilder cols = new StringBuilder("[");
    for (int i = 1; i <= colCount; i++) {
      if (i > 1) cols.append(",");
      cols.append("{\"name\":\"").append(escape(meta.getColumnName(i))).append("\"");
      cols.append(",\"type\":\"").append(escape(meta.getColumnTypeName(i))).append("\"}");
    }
    cols.append("]");

    StringBuilder rows = new StringBuilder("[");
    boolean firstRow = true;
    while (rs.next()) {
      if (!firstRow) rows.append(",");
      rows.append("[");
      for (int i = 1; i <= colCount; i++) {
        if (i > 1) rows.append(",");
        Object val = rs.getObject(i);
        if (rs.wasNull() || val == null) {
          rows.append("null");
        } else if (val instanceof Number || val instanceof Boolean) {
          rows.append(val);
        } else {
          rows.append("\"").append(escape(val.toString())).append("\"");
        }
      }
      rows.append("]");
      firstRow = false;
    }
    rows.append("]");

    return "{\"columns\":" + cols + ",\"rows\":" + rows + ",\"rowCount\":" + (firstRow ? 0 : "null") + "}";
  }

  static String extractString(String json, String key) {
    if (json == null) return null;
    Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(json);
    if (m.find()) return m.group(1).replace("\\\"", "\"").replace("\\\\", "\\");
    m = Pattern.compile("\"" + key + "\"\\s*:\\s*(null)\\s*[,}]").matcher(json);
    if (m.find()) return null;
    m = Pattern.compile("\"" + key + "\"\\s*:\\s*((?:\\[[^]]+\\]|\\{[^}]+\\}))").matcher(json);
    if (m.find()) return m.group(1);
    return null;
  }

  static int extractInt(String json, String key) {
    if (json == null) return 0;
    Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*(\\d+)").matcher(json);
    return m.find() ? Integer.parseInt(m.group(1)) : 0;
  }

  static String[] parseJsonArray(String arrayJson) {
    if (arrayJson == null || arrayJson.isBlank() || arrayJson.equals("null")) return new String[0];
    List<String> list = new ArrayList<>();
    Matcher m = Pattern.compile("\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(arrayJson);
    while (m.find()) list.add(m.group(1));
    return list.toArray(new String[0]);
  }

  static String errorJson(Exception e) {
    StringBuilder sb = new StringBuilder();
    Throwable cur = e;
    boolean first = true;
    while (cur != null) {
      if (!first) sb.append(" (caused by: ");
      String msg = cur.getMessage();
      if (msg == null || msg.isEmpty()) msg = cur.getClass().getSimpleName();
      sb.append(first ? msg : cur.getClass().getSimpleName() + ": " + msg);
      if (!first) sb.append(")");
      first = false;
      cur = cur.getCause();
    }
    return "{\"error\":\"" + escape(sb.toString()) + "\"}";
  }

  static String escape(String s) {
    if (s == null) return "";
    return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
  }

  static String nullToEmpty(String s) { return s == null ? "" : s; }

  static void respond(int session, boolean ok, String data, String reqId) {
    String resp = "{\"ok\":" + ok + ",\"session\":" + session + ",\"reqId\":" + (reqId != null ? "\"" + reqId + "\"" : "null") + ",\"data\":" + data + "}";
    System.out.println(resp);
    System.out.flush();
  }

  static class Session {
    final Connection conn;
    final URLClassLoader loader;
    Session(Connection conn, URLClassLoader loader) { this.conn = conn; this.loader = loader; }
  }
}
