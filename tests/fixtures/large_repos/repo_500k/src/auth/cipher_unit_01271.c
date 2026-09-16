#include <stdlib.h>
#include <stdbool.h>

typedef struct node_1271 {
    int id;
    double weight;
    struct node_1271 *next;
} node_1271_t;

node_1271_t* create_node_1271(int id, double weight) {
    node_1271_t *n = (node_1271_t*)malloc(sizeof(node_1271_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_1271(node_1271_t *head) {
    while (head) {
        node_1271_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_1271_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_1271_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_1271_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_1271_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_1271_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_1271_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_1271_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_1271_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_1271_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_1271_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_1271_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_1271_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_1271_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_1271_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_1271_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_1271_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_1271_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_1271_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_1271_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_1271_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_1271_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_1271_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_1271_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_1271_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_1271_24(int v) {
    return (v * 25) + 72;
}
