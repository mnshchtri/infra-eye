package handlers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"github.com/infra-eye/backend/internal/resources"
)

// identPattern restricts a SQL identifier (schema/table/column name) to a
// plain ASCII letter-or-underscore start followed by letters/digits/
// underscores — every real name introspection ever returns matches this.
// Anchoring the whole string against a fixed, SQL-metacharacter-free
// character class is what lets a static analyzer (this closes CodeQL
// go/sql-injection alerts #26-30) recognize the check as an actual sanitizer
// for the string that follows, rather than trusting quoteIdent's escaping —
// which is correct but, being a custom function, isn't something static
// analysis can verify — to carry that weight alone.
var identPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func validateIdent(kind, name string) error {
	if !identPattern.MatchString(name) {
		return fmt.Errorf("invalid %s name %q", kind, name)
	}
	return nil
}

// loadSQLResource fetches the resource and rejects anything OpenSQL can't
// handle, so every schema/table endpoint below shares one error shape
// instead of repeating the same two checks.
func loadSQLResource(c *gin.Context) (models.Resource, bool) {
	var resource models.Resource
	if err := db.DB.First(&resource, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
		return resource, false
	}
	if !resources.IsPostgres(resource.Protocol) && !resources.IsMySQL(resource.Protocol) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only postgres and mysql support schema browsing currently"})
		return resource, false
	}
	return resource, true
}

// quoteIdent quotes a schema/table/column name the way each dialect expects
// ("double quotes" for Postgres, `backticks` for MySQL), doubling any
// embedded quote character — the standard identifier-escaping rule for both,
// and safe here because these values always originate from a prior
// introspection query below, never straight from request input.
func quoteIdent(isPostgres bool, ident string) string {
	if isPostgres {
		return `"` + strings.ReplaceAll(ident, `"`, `""`) + `"`
	}
	return "`" + strings.ReplaceAll(ident, "`", "``") + "`"
}

// resolveTable looks up (schema, table) in the live catalog and returns the
// catalog's *own* copy of those two strings rather than the caller-supplied
// ones. schema/table reach these handlers as raw path params, and every
// query below that needs them as *identifiers* (a FROM/INTO target, which
// SQL gives no parameter-binding syntax for) has to build that fragment by
// string concatenation after quoteIdent escapes it. Re-deriving the value
// from a Scan() result here — rather than trusting quoteIdent's escaping (a
// custom function no static analyzer can verify) or a hand-written format
// check (which analyzers don't treat as breaking taint either) — is what
// actually severs the flow from request input to query text: every later
// use reads a value that came out of a database catalog lookup, not out of
// the HTTP request. It also turns a typo or crafted name into a clean 404
// instead of a confusing driver error.
func resolveTable(ctx context.Context, conn *sql.DB, isPG bool, schema, table string) (safeSchema, safeTable string, err error) {
	if isPG {
		err = conn.QueryRowContext(ctx,
			`SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2 AND table_type = 'BASE TABLE'`,
			schema, table).Scan(&safeSchema, &safeTable)
	} else {
		err = conn.QueryRowContext(ctx,
			`SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = ? AND table_type = 'BASE TABLE'`,
			schema, table).Scan(&safeSchema, &safeTable)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", fmt.Errorf("table %s.%s not found (or has no columns visible to this user)", schema, table)
	}
	if err != nil {
		return "", "", fmt.Errorf("verify table: %w", err)
	}
	return safeSchema, safeTable, nil
}

type schemaGroup struct {
	Schema string   `json:"schema"`
	Tables []string `json:"tables"`
}

// GetResourceSchema lists every user schema/table the resource's connected
// database exposes. Postgres: every non-system schema in the current
// database (information_schema.tables is already scoped to it). MySQL has
// no separate schema concept — table_schema *is* the database name — so this
// scopes to the resource's own configured database rather than every
// database the credential can see, which would be surprising and a bigger
// exposure than the resource was configured for.
func GetResourceSchema(c *gin.Context) {
	resource, ok := loadSQLResource(c)
	if !ok {
		return
	}
	conn, err := resources.OpenSQL(c.Request.Context(), resource)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("connect to target: %v", err)})
		return
	}
	defer conn.Close()

	var rows *sql.Rows
	if resources.IsPostgres(resource.Protocol) {
		rows, err = conn.QueryContext(c.Request.Context(), `
			SELECT table_schema, table_name FROM information_schema.tables
			WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
			ORDER BY table_schema, table_name`)
	} else {
		dbName := resource.Database
		rows, err = conn.QueryContext(c.Request.Context(), `
			SELECT table_schema, table_name FROM information_schema.tables
			WHERE table_type = 'BASE TABLE' AND table_schema = ?
			ORDER BY table_schema, table_name`, dbName)
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("list tables: %v", err)})
		return
	}
	defer rows.Close()

	order := []string{}
	byName := map[string]*schemaGroup{}
	for rows.Next() {
		var schema, table string
		if err := rows.Scan(&schema, &table); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("scan: %v", err)})
			return
		}
		g, exists := byName[schema]
		if !exists {
			g = &schemaGroup{Schema: schema, Tables: []string{}}
			byName[schema] = g
			order = append(order, schema)
		}
		g.Tables = append(g.Tables, table)
	}

	out := make([]schemaGroup, 0, len(order))
	for _, name := range order {
		out = append(out, *byName[name])
	}
	c.JSON(http.StatusOK, out)
}

type columnInfo struct {
	Name       string  `json:"name"`
	Type       string  `json:"type"`
	Nullable   bool    `json:"nullable"`
	Default    *string `json:"default,omitempty"`
	PrimaryKey bool    `json:"primary_key"`
}

// GetResourceTableColumns reports each column's type/nullability/default and
// whether it's part of the table's primary key — the DataGrid (added in a
// later slice) uses PrimaryKey to decide whether inline row editing is safe
// to offer at all for this table.
func GetResourceTableColumns(c *gin.Context) {
	resource, ok := loadSQLResource(c)
	if !ok {
		return
	}
	schema, table := c.Param("schema"), c.Param("table")
	if err := validateIdent("schema", schema); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateIdent("table", table); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	conn, err := resources.OpenSQL(c.Request.Context(), resource)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("connect to target: %v", err)})
		return
	}
	defer conn.Close()

	var rows *sql.Rows
	if resources.IsPostgres(resource.Protocol) {
		rows, err = conn.QueryContext(c.Request.Context(), `
			SELECT c.column_name, c.data_type, c.is_nullable = 'YES', c.column_default,
			       EXISTS (
			         SELECT 1 FROM information_schema.key_column_usage kcu
			         JOIN information_schema.table_constraints tc
			           ON tc.constraint_name = kcu.constraint_name
			           AND tc.constraint_schema = kcu.constraint_schema
			           AND tc.constraint_type = 'PRIMARY KEY'
			         WHERE kcu.table_schema = c.table_schema AND kcu.table_name = c.table_name
			           AND kcu.column_name = c.column_name
			       ) AS is_primary_key
			FROM information_schema.columns c
			WHERE c.table_schema = $1 AND c.table_name = $2
			ORDER BY c.ordinal_position`, schema, table)
	} else {
		rows, err = conn.QueryContext(c.Request.Context(), `
			SELECT column_name, data_type, is_nullable = 'YES', column_default, column_key = 'PRI'
			FROM information_schema.columns
			WHERE table_schema = ? AND table_name = ?
			ORDER BY ordinal_position`, schema, table)
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("list columns: %v", err)})
		return
	}
	defer rows.Close()

	cols := []columnInfo{}
	for rows.Next() {
		var col columnInfo
		var def sql.NullString
		if err := rows.Scan(&col.Name, &col.Type, &col.Nullable, &def, &col.PrimaryKey); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("scan: %v", err)})
			return
		}
		if def.Valid {
			col.Default = &def.String
		}
		cols = append(cols, col)
	}
	if len(cols) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("table %s.%s not found (or has no columns visible to this user)", schema, table)})
		return
	}
	c.JSON(http.StatusOK, cols)
}

const (
	defaultRowLimit = 100
	maxRowLimit     = 1000
)

// GetResourceTableRows returns one page of a table's rows plus a total count
// for pagination. schema/table are checked against the live schema
// (verifyTableExists) before being quoted into the query as identifiers;
// limit/offset are bound parameters.
func GetResourceTableRows(c *gin.Context) {
	resource, ok := loadSQLResource(c)
	if !ok {
		return
	}
	schema, table := c.Param("schema"), c.Param("table")
	if err := validateIdent("schema", schema); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateIdent("table", table); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	isPG := resources.IsPostgres(resource.Protocol)

	limit := defaultRowLimit
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= maxRowLimit {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v >= 0 {
		offset = v
	}

	conn, err := resources.OpenSQL(c.Request.Context(), resource)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("connect to target: %v", err)})
		return
	}
	defer conn.Close()

	safeSchema, safeTable, err := resolveTable(c.Request.Context(), conn, isPG, schema, table)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	schema, table = safeSchema, safeTable
	qualified := quoteIdent(isPG, schema) + "." + quoteIdent(isPG, table)

	var total int64
	if err := conn.QueryRowContext(c.Request.Context(), "SELECT COUNT(*) FROM "+qualified).Scan(&total); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("count rows: %v", err)})
		return
	}

	placeholder1, placeholder2 := "$1", "$2"
	if !isPG {
		placeholder1, placeholder2 = "?", "?"
	}
	query := fmt.Sprintf("SELECT * FROM %s LIMIT %s OFFSET %s", qualified, placeholder1, placeholder2)
	rows, err := conn.QueryContext(c.Request.Context(), query, limit, offset)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("fetch rows: %v", err)})
		return
	}
	defer rows.Close()

	columns, _ := rows.Columns()
	result := []map[string]interface{}{}
	for rows.Next() {
		values := make([]interface{}, len(columns))
		ptrs := make([]interface{}, len(columns))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("scan: %v", err)})
			return
		}
		row := map[string]interface{}{}
		for i, col := range columns {
			if b, ok := values[i].([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = values[i]
			}
		}
		result = append(result, row)
	}

	logResourceAudit(c, resource.ID, currentUserID(c), "browse_table", gin.H{"schema": schema, "table": table, "limit": limit, "offset": offset})
	c.JSON(http.StatusOK, gin.H{"columns": columns, "rows": result, "total": total, "limit": limit, "offset": offset})
}

// primaryKeyColumns returns a table's primary-key column names in ordinal
// order — empty if it has none. Shared by the mutation endpoints below to
// enforce the "no PK, no editing" safety rule: a table without one can't be
// updated/deleted by a single row's values without risking a WHERE that
// matches more than the one row the client actually meant.
func primaryKeyColumns(ctx context.Context, conn *sql.DB, isPG bool, schema, table string) ([]string, error) {
	var rows *sql.Rows
	var err error
	if isPG {
		rows, err = conn.QueryContext(ctx, `
			SELECT kcu.column_name
			FROM information_schema.key_column_usage kcu
			JOIN information_schema.table_constraints tc
			  ON tc.constraint_name = kcu.constraint_name
			  AND tc.constraint_schema = kcu.constraint_schema
			  AND tc.constraint_type = 'PRIMARY KEY'
			WHERE kcu.table_schema = $1 AND kcu.table_name = $2
			ORDER BY kcu.ordinal_position`, schema, table)
	} else {
		rows, err = conn.QueryContext(ctx, `
			SELECT column_name FROM information_schema.columns
			WHERE table_schema = ? AND table_name = ? AND column_key = 'PRI'
			ORDER BY ordinal_position`, schema, table)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols := []string{}
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			return nil, err
		}
		cols = append(cols, col)
	}
	return cols, nil
}

// pkWhereClause builds a "col1 = ? AND col2 = ? ..." fragment (bound
// parameters, not concatenated values) from a request's where map, requiring
// it to specify *exactly* the table's real primary-key columns — not a
// subset (which could match more than one row), not extra/unrelated columns
// substituted for them. argOffset lets callers place this after other bound
// parameters (e.g. an UPDATE's SET values) in the same query.
func pkWhereClause(isPG bool, pkCols []string, where map[string]interface{}, argOffset int) (clause string, args []interface{}, err error) {
	if len(pkCols) == 0 {
		return "", nil, fmt.Errorf("table has no primary key — row editing is not supported for it")
	}
	if len(where) != len(pkCols) {
		return "", nil, fmt.Errorf("where must specify exactly the table's primary key column(s): %s", strings.Join(pkCols, ", "))
	}
	parts := make([]string, 0, len(pkCols))
	for i, col := range pkCols {
		val, ok := where[col]
		if !ok {
			return "", nil, fmt.Errorf("where is missing primary key column %q", col)
		}
		if isPG {
			parts = append(parts, fmt.Sprintf("%s = $%d", quoteIdent(isPG, col), argOffset+i+1))
		} else {
			parts = append(parts, fmt.Sprintf("%s = ?", quoteIdent(isPG, col)))
		}
		args = append(args, val)
	}
	return strings.Join(parts, " AND "), args, nil
}

type rowInsertRequest struct {
	Values map[string]interface{} `json:"values" binding:"required"`
}

// PostResourceTableRow inserts one row. Column names come from the request
// body (not restricted to a pre-verified allow-list the way schema/table
// are), but every one is quoted as an identifier the same way schema/table
// are elsewhere in this file, and every value is a bound parameter — a typo'd
// or nonexistent column simply fails with the database's own real error.
func PostResourceTableRow(c *gin.Context) {
	resource, ok := loadSQLResource(c)
	if !ok {
		return
	}
	if !requireWriteAccess(c, resource.ID) {
		return
	}
	schema, table := c.Param("schema"), c.Param("table")
	if err := validateIdent("schema", schema); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateIdent("table", table); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	isPG := resources.IsPostgres(resource.Protocol)

	var req rowInsertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Values) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "values must not be empty"})
		return
	}

	conn, err := resources.OpenSQL(c.Request.Context(), resource)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("connect to target: %v", err)})
		return
	}
	defer conn.Close()

	safeSchema, safeTable, err := resolveTable(c.Request.Context(), conn, isPG, schema, table)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	schema, table = safeSchema, safeTable

	cols := make([]string, 0, len(req.Values))
	placeholders := make([]string, 0, len(req.Values))
	args := make([]interface{}, 0, len(req.Values))
	i := 1
	for col, val := range req.Values {
		if err := validateIdent("column", col); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		cols = append(cols, quoteIdent(isPG, col))
		if isPG {
			placeholders = append(placeholders, fmt.Sprintf("$%d", i))
		} else {
			placeholders = append(placeholders, "?")
		}
		args = append(args, val)
		i++
	}
	qualified := quoteIdent(isPG, schema) + "." + quoteIdent(isPG, table)
	query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", qualified, strings.Join(cols, ", "), strings.Join(placeholders, ", "))

	res, err := conn.ExecContext(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("insert failed: %v", err)})
		return
	}
	affected, _ := res.RowsAffected()

	logResourceAudit(c, resource.ID, currentUserID(c), "insert_row", gin.H{"schema": schema, "table": table, "values": req.Values})
	c.JSON(http.StatusOK, gin.H{"rows_affected": affected})
}

type rowUpdateRequest struct {
	Set   map[string]interface{} `json:"set" binding:"required"`
	Where map[string]interface{} `json:"where" binding:"required"`
}

// PutResourceTableRow updates exactly the row identified by Where, which
// must be the table's real primary key (see pkWhereClause) — the client is
// expected to send back the PK value(s) from the row it fetched via
// GetResourceTableRows, not an arbitrary filter.
func PutResourceTableRow(c *gin.Context) {
	resource, ok := loadSQLResource(c)
	if !ok {
		return
	}
	if !requireWriteAccess(c, resource.ID) {
		return
	}
	schema, table := c.Param("schema"), c.Param("table")
	if err := validateIdent("schema", schema); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateIdent("table", table); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	isPG := resources.IsPostgres(resource.Protocol)

	var req rowUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Set) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "set must not be empty"})
		return
	}

	conn, err := resources.OpenSQL(c.Request.Context(), resource)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("connect to target: %v", err)})
		return
	}
	defer conn.Close()

	safeSchema, safeTable, err := resolveTable(c.Request.Context(), conn, isPG, schema, table)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	schema, table = safeSchema, safeTable
	pkCols, err := primaryKeyColumns(c.Request.Context(), conn, isPG, schema, table)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("resolve primary key: %v", err)})
		return
	}

	setClauses := make([]string, 0, len(req.Set))
	args := make([]interface{}, 0, len(req.Set)+len(req.Where))
	i := 1
	for col, val := range req.Set {
		if err := validateIdent("column", col); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if isPG {
			setClauses = append(setClauses, fmt.Sprintf("%s = $%d", quoteIdent(isPG, col), i))
		} else {
			setClauses = append(setClauses, fmt.Sprintf("%s = ?", quoteIdent(isPG, col)))
		}
		args = append(args, val)
		i++
	}
	whereClause, whereArgs, err := pkWhereClause(isPG, pkCols, req.Where, len(req.Set))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	args = append(args, whereArgs...)

	qualified := quoteIdent(isPG, schema) + "." + quoteIdent(isPG, table)
	query := fmt.Sprintf("UPDATE %s SET %s WHERE %s", qualified, strings.Join(setClauses, ", "), whereClause)

	res, err := conn.ExecContext(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("update failed: %v", err)})
		return
	}
	affected, _ := res.RowsAffected()

	logResourceAudit(c, resource.ID, currentUserID(c), "edit_row", gin.H{"schema": schema, "table": table, "set": req.Set, "where": req.Where, "rows_affected": affected})
	c.JSON(http.StatusOK, gin.H{"rows_affected": affected})
}

type rowDeleteRequest struct {
	Where map[string]interface{} `json:"where" binding:"required"`
}

// DeleteResourceTableRow deletes exactly the row identified by Where, under
// the same primary-key-only rule as PutResourceTableRow.
func DeleteResourceTableRow(c *gin.Context) {
	resource, ok := loadSQLResource(c)
	if !ok {
		return
	}
	if !requireWriteAccess(c, resource.ID) {
		return
	}
	schema, table := c.Param("schema"), c.Param("table")
	if err := validateIdent("schema", schema); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateIdent("table", table); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	isPG := resources.IsPostgres(resource.Protocol)

	var req rowDeleteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	conn, err := resources.OpenSQL(c.Request.Context(), resource)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("connect to target: %v", err)})
		return
	}
	defer conn.Close()

	safeSchema, safeTable, err := resolveTable(c.Request.Context(), conn, isPG, schema, table)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	schema, table = safeSchema, safeTable
	pkCols, err := primaryKeyColumns(c.Request.Context(), conn, isPG, schema, table)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("resolve primary key: %v", err)})
		return
	}
	whereClause, args, err := pkWhereClause(isPG, pkCols, req.Where, 0)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	qualified := quoteIdent(isPG, schema) + "." + quoteIdent(isPG, table)
	query := fmt.Sprintf("DELETE FROM %s WHERE %s", qualified, whereClause)

	res, err := conn.ExecContext(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("delete failed: %v", err)})
		return
	}
	affected, _ := res.RowsAffected()

	logResourceAudit(c, resource.ID, currentUserID(c), "delete_row", gin.H{"schema": schema, "table": table, "where": req.Where, "rows_affected": affected})
	c.JSON(http.StatusOK, gin.H{"rows_affected": affected})
}
