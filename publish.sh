#!/usr/bin/env bash

set -e

echo "🚀 Streambin Publishing Script"
echo "=============================="
echo ""

# Check if logged in to npm
if ! npm whoami &> /dev/null; then
  echo "❌ Not logged in to npm"
  echo "Please run: npm login"
  exit 1
fi

NPM_USER=$(npm whoami)
echo "✅ Logged in as: $NPM_USER"
echo ""

# Get current version from root package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📌 Current version: $CURRENT_VERSION"
echo ""

# Ask what kind of version bump
echo "What kind of version bump?"
echo "  1) patch (0.1.0 -> 0.1.1)"
echo "  2) minor (0.1.0 -> 0.2.0)"
echo "  3) major (0.1.0 -> 1.0.0)"
echo "  4) custom (specify version)"
echo "  5) no change (keep $CURRENT_VERSION)"
echo ""
read -p "Choose (1-5): " -n 1 -r BUMP_TYPE
echo ""
echo ""

# Calculate new version
case $BUMP_TYPE in
  1)
    # Patch bump
    NEW_VERSION=$(node -p "
      const v = '$CURRENT_VERSION'.split('.');
      v[2] = String(Number(v[2]) + 1);
      v.join('.');
    ")
    ;;
  2)
    # Minor bump
    NEW_VERSION=$(node -p "
      const v = '$CURRENT_VERSION'.split('.');
      v[1] = String(Number(v[1]) + 1);
      v[2] = '0';
      v.join('.');
    ")
    ;;
  3)
    # Major bump
    NEW_VERSION=$(node -p "
      const v = '$CURRENT_VERSION'.split('.');
      v[0] = String(Number(v[0]) + 1);
      v[1] = '0';
      v[2] = '0';
      v.join('.');
    ")
    ;;
  4)
    # Custom version
    read -p "Enter new version: " NEW_VERSION
    ;;
  5)
    # No change
    NEW_VERSION=$CURRENT_VERSION
    ;;
  *)
    echo "❌ Invalid choice"
    exit 1
    ;;
esac

echo "📦 New version: $NEW_VERSION"
echo ""

if [ "$NEW_VERSION" != "$CURRENT_VERSION" ]; then
  echo "🔄 Updating version in all packages..."
  
  # Update root package.json
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = '$NEW_VERSION';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "  ✓ package.json"
  
  # Update all package packages
  for dir in packages/shared packages/crypto packages/sdk packages/react-sdk packages/cli; do
    if [ -f "$dir/package.json" ]; then
      node -e "
        const fs = require('fs');
        const path = '$dir/package.json';
        const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
        pkg.version = '$NEW_VERSION';
        fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
      "
      echo "  ✓ $dir/package.json"
    fi
  done
  
  echo "✅ Version updated to $NEW_VERSION"
  echo ""
else
  echo "ℹ️  Keeping version $CURRENT_VERSION"
  echo ""
fi

# Build all packages
echo "📦 Building all packages..."
pnpm build
echo "✅ Build complete"
echo ""

# Run tests
echo "🧪 Running tests..."
pnpm test
echo "✅ Tests passed"
echo ""

# Typecheck
echo "🔍 Typechecking..."
pnpm typecheck
echo "✅ Typecheck passed"
echo ""

# Helper: publish one package with workspace:* replaced by the real version
publish_package() {
  local dir="$1"
  local pkg_name="$2"

  echo "Publishing $pkg_name@$NEW_VERSION..."

  # Rewrite workspace:* -> ^NEW_VERSION in a temp copy of package.json
  node -e "
    const fs = require('fs');
    const path = '$dir/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    const rewrite = (deps) => {
      if (!deps) return;
      for (const k of Object.keys(deps)) {
        if (deps[k] === 'workspace:*') deps[k] = '^$NEW_VERSION';
      }
    };
    rewrite(pkg.dependencies);
    rewrite(pkg.devDependencies);
    rewrite(pkg.peerDependencies);
    fs.writeFileSync(path + '.publish', JSON.stringify(pkg, null, 2) + '\n');
  "

  # Swap in the rewritten file, publish, then restore original
  cp "$dir/package.json" "$dir/package.json.bak"
  cp "$dir/package.json.publish" "$dir/package.json"
  rm "$dir/package.json.publish"

  (cd "$dir" && npm publish --access public)
  local status=$?

  # Always restore original
  mv "$dir/package.json.bak" "$dir/package.json"

  if [ $status -ne 0 ]; then
    echo "❌ Failed to publish $pkg_name"
    exit 1
  fi

  echo "✅ $pkg_name@$NEW_VERSION published"
  echo ""
}

# Publish packages in dependency order
echo "📤 Publishing packages to npm..."
echo ""

publish_package "packages/shared"    "@streambin/shared"
publish_package "packages/crypto"    "@streambin/crypto"
publish_package "packages/sdk"       "@streambin/sdk"
publish_package "packages/react-sdk" "@streambin/react-sdk"
publish_package "packages/cli"       "streambin.xyz"

echo "🎉 All packages published successfully!"
echo ""
echo "📋 Published packages:"
echo "  - @streambin/shared@$NEW_VERSION"
echo "  - @streambin/crypto@$NEW_VERSION"
echo "  - @streambin/sdk@$NEW_VERSION"
echo "  - @streambin/react-sdk@$NEW_VERSION"
echo "  - streambin.xyz@$NEW_VERSION"
echo ""

# Ask if user wants to deploy server
read -p "🌐 Deploy server to Vercel? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "🚀 Deploying to Vercel..."
  cd apps/server
  vercel --prod
  cd ../..
  echo "✅ Server deployed!"
  echo ""
  
  # Wait a bit for deployment
  echo "⏳ Waiting 5 seconds for deployment to propagate..."
  sleep 5
  
  # Run E2E tests
  echo "🧪 Running E2E tests..."
  pnpm e2e
  echo "✅ E2E tests passed!"
fi

echo ""
echo "✨ Deployment complete!"
echo ""
echo "📖 Documentation: https://streambin.xyz"
echo "📦 npm packages: https://www.npmjs.com/search?q=%40streambin"
echo "🔗 Repository: https://github.com/smarcombes/streambin"
echo ""
echo "🎯 Next steps:"
echo "  - Create git tag: git tag v$NEW_VERSION && git push --tags"
echo "  - Create GitHub release"
