-- Run while connected as REXADB (APP_USER).
-- Creates a demo materialized view for catalog browsing.

BEGIN
  EXECUTE IMMEDIATE 'DROP MATERIALIZED VIEW mv_dept_headcount';
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
/

CREATE MATERIALIZED VIEW mv_dept_headcount
BUILD IMMEDIATE
REFRESH COMPLETE ON DEMAND
AS
SELECT d.id AS department_id, d.name AS department_name, COUNT(e.id) AS employee_count
FROM departments d
LEFT JOIN employees e ON e.department_id = d.id
GROUP BY d.id, d.name;
