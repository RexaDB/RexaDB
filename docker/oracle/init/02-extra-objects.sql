-- Extra Oracle objects for RexaDB catalog demos.
-- Views, indexes, a PL/SQL package, and a database link.
-- Safe to re-run (CREATE OR REPLACE / drop-if-exists patterns).

ALTER SESSION SET CONTAINER = FREEPDB1;

-- ========== INDEXES ==========
-- Speed up lookups by email and department.
BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX rexadb.idx_employees_email ON rexadb.employees (email)';
EXCEPTION
  WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX rexadb.idx_employees_dept ON rexadb.employees (department_id)';
EXCEPTION
  WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX rexadb.idx_departments_name ON rexadb.departments (name)';
EXCEPTION
  WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

-- ========== VIEWS ==========
CREATE OR REPLACE VIEW rexadb.v_employee_directory AS
SELECT
  e.id,
  e.first_name || ' ' || e.last_name AS full_name,
  e.email,
  e.salary,
  d.name AS department_name,
  d.location
FROM rexadb.employees e
LEFT JOIN rexadb.departments d ON d.id = e.department_id;

CREATE OR REPLACE VIEW rexadb.v_dept_salary_summary AS
SELECT
  d.id AS department_id,
  d.name AS department_name,
  COUNT(e.id) AS employee_count,
  NVL(SUM(e.salary), 0) AS total_salary,
  NVL(AVG(e.salary), 0) AS avg_salary
FROM rexadb.departments d
LEFT JOIN rexadb.employees e ON e.department_id = d.id
GROUP BY d.id, d.name;

-- ========== PACKAGE (spec + body) ==========
-- A package groups related PL/SQL procedures/functions, like a module/library.
CREATE OR REPLACE PACKAGE rexadb.emp_utils AS
  FUNCTION full_name(p_id IN NUMBER) RETURN VARCHAR2;
  FUNCTION raise_salary(p_id IN NUMBER, p_pct IN NUMBER) RETURN NUMBER;
  PROCEDURE list_by_department(p_dept_id IN NUMBER);
END emp_utils;
/

CREATE OR REPLACE PACKAGE BODY rexadb.emp_utils AS
  FUNCTION full_name(p_id IN NUMBER) RETURN VARCHAR2 IS
    v_name VARCHAR2(200);
  BEGIN
    SELECT first_name || ' ' || last_name INTO v_name
    FROM employees WHERE id = p_id;
    RETURN v_name;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RETURN NULL;
  END full_name;

  FUNCTION raise_salary(p_id IN NUMBER, p_pct IN NUMBER) RETURN NUMBER IS
    v_new NUMBER(10, 2);
  BEGIN
    UPDATE employees
       SET salary = ROUND(salary * (1 + NVL(p_pct, 0) / 100), 2)
     WHERE id = p_id
     RETURNING salary INTO v_new;
    RETURN v_new;
  END raise_salary;

  PROCEDURE list_by_department(p_dept_id IN NUMBER) IS
  BEGIN
    FOR r IN (
      SELECT id, first_name, last_name, salary
      FROM employees
      WHERE department_id = p_dept_id
      ORDER BY last_name
    ) LOOP
      NULL; -- demo body; real apps would pipe rows or log them
    END LOOP;
  END list_by_department;
END emp_utils;
/

-- ========== MATERIALIZED VIEW ==========
BEGIN
  EXECUTE IMMEDIATE 'GRANT CREATE MATERIALIZED VIEW TO rexadb';
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
/
BEGIN
  EXECUTE IMMEDIATE 'GRANT QUERY REWRITE TO rexadb';
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
/
-- Created as REXADB in 02c-mview-as-appuser.sql (needs APP_USER session).

-- ========== SEQUENCE ==========
BEGIN
  EXECUTE IMMEDIATE 'CREATE SEQUENCE rexadb.emp_id_seq START WITH 100 INCREMENT BY 1 NOCACHE';
EXCEPTION
  WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

-- ========== SYNONYM ==========
BEGIN
  EXECUTE IMMEDIATE 'CREATE OR REPLACE SYNONYM rexadb.emp FOR rexadb.employees';
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
/

-- ========== TRIGGER ==========
CREATE OR REPLACE TRIGGER rexadb.trg_employees_bi
BEFORE INSERT ON rexadb.employees
FOR EACH ROW
BEGIN
  IF :NEW.hire_date IS NULL THEN
    :NEW.hire_date := SYSDATE;
  END IF;
END;
/

-- App user needs this to create private DB links (see 02b-dblink-as-appuser.sql).
BEGIN
  EXECUTE IMMEDIATE 'GRANT CREATE DATABASE LINK TO rexadb';
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
/

COMMIT;
