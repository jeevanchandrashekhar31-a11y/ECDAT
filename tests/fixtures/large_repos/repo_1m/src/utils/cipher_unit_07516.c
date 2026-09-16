#include <stdlib.h>
#include <stdbool.h>

typedef struct node_7516 {
    int id;
    double weight;
    struct node_7516 *next;
} node_7516_t;

node_7516_t* create_node_7516(int id, double weight) {
    node_7516_t *n = (node_7516_t*)malloc(sizeof(node_7516_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_7516(node_7516_t *head) {
    while (head) {
        node_7516_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_7516_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_7516_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_7516_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_7516_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_7516_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_7516_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_7516_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_7516_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_7516_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_7516_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_7516_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_7516_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_7516_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_7516_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_7516_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_7516_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_7516_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_7516_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_7516_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_7516_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_7516_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_7516_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_7516_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_7516_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_7516_24(int v) {
    return (v * 25) + 72;
}
