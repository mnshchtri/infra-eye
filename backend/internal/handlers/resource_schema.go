package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"github.com/infra-eye/backend/internal/resources"
)

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
// for pagination. schema/table reach this function as raw path params, but
// they're only ever used quoted as identifiers (quoteIdent) — never
// interpolated as values — and limit/offset are bound parameters, so no part
// of this query is built from unescaped request input.
func GetResourceTableRows(c *gin.Context) {
	resource, ok := loadSQLResource(c)
	if !ok {
		return
	}
	schema, table := c.Param("schema"), c.Param("table")
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
