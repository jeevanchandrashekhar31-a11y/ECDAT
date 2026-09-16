#include <stdlib.h>
#include <stdbool.h>

typedef struct node_6006 {
    int id;
    double weight;
    struct node_6006 *next;
} node_6006_t;

node_6006_t* create_node_6006(int id, double weight) {
    node_6006_t *n = (node_6006_t*)malloc(sizeof(node_6006_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_6006(node_6006_t *head) {
    while (head) {
        node_6006_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_6006_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_6006_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_6006_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_6006_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_6006_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_6006_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_6006_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_6006_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_6006_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_6006_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_6006_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_6006_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_6006_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_6006_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_6006_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_6006_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_6006_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_6006_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_6006_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_6006_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_6006_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_6006_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_6006_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_6006_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_6006_24(int v) {
    return (v * 25) + 72;
}
