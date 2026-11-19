export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow unquoted URL literals in JSX attributes',
      category: 'Syntax',
      recommended: true,
    },
    messages: {
      brokenUrl: 'Unquoted URL in JSX attribute "{{attr}}" will fail. Use quotes: {{attr}}={"{{url}}"} or backticks {{attr}}={`{{url}}`}',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      JSXAttribute(node) {
        // Check if this is an href, src, action, or similar URL-like attribute
        const attrName = node.name?.name;
        if (!attrName || !['href', 'src', 'action', 'data'].includes(attrName)) {
          return;
        }

        // Check if the value is a JSXExpressionContainer with just an identifier/member expression
        if (!node.value || node.value.type !== 'JSXExpressionContainer') {
          return;
        }

        const expr = node.value.expression;
        if (expr.type === 'JSXEmptyExpression') {
          return;
        }

        // Get the source code text of the expression
        const text = sourceCode.getText(expr);

        // Check for patterns like "https://..." (contains :// without being quoted)
        if (text.match(/^https?:\/\//) && !text.startsWith('"') && !text.startsWith("'") && !text.startsWith('`')) {
          context.report({
            node,
            messageId: 'brokenUrl',
            data: {
              attr: attrName,
              url: text,
            },
          });
        }
      },
    };
  },
};
