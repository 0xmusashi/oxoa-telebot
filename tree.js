class Node {
    constructor(data) {
        this.data = data;
        this.children = [];
    }

    addChild(child) {
        this.children.push(child);
    }
}

class Tree {
    constructor(root) {
        this.root = root;
    }

    // Traversal methods (pre-order, in-order, post-order)
    preorderTraversal(node = this.root, level = 0) {
        if (node) {
            console.log(`Level ${level}: ${node.data}`);
            level++;
            node.children.forEach(child => this.preorderTraversal(child, level));
        }
    }

    preOrderInsert(parent, child) {
        if (!parent) {
            throw new Error("Parent node cannot be null");
        }
        parent.children.unshift(child); // Insert child at the beginning for pre-order
        // child.children.forEach(grandchild => this.preOrderInsert(parent, grandchild)); // Recursively insert grandchildren
        child.children.forEach(grandchild => this.preOrderInsert(child, grandchild)); // Recursively insert grandchildren
    }

}

// Example usage
const root = new Node("A");
const child1 = new Node("B");
const child2 = new Node("C");
const grandchild1 = new Node("D");
const grandchild2 = new Node("E");
const grandchild3 = new Node("F");

child1.addChild(grandchild1);
child1.addChild(grandchild2);
child1.addChild(grandchild3);

const tree = new Tree(root);

tree.preOrderInsert(root, child1);
tree.preOrderInsert(root, child2);
// tree.preOrderInsert(child2, grandchild1);
// tree.preOrderInsert(child2, grandchild2);
// tree.preOrderInsert(child2, grandchild3);

console.log("Pre-order traversal:");
tree.preorderTraversal();

