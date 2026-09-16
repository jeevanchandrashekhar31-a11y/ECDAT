#include <stdlib.h>
#include <stdbool.h>

typedef struct node_3286 {
    int id;
    double weight;
    struct node_3286 *next;
} node_3286_t;

node_3286_t* create_node_3286(int id, double weight) {
    node_3286_t *n = (node_3286_t*)malloc(sizeof(node_3286_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_3286(node_3286_t *head) {
    while (head) {
        node_3286_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_3286_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_3286_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_3286_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_3286_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_3286_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_3286_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_3286_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_3286_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_3286_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_3286_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_3286_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_3286_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_3286_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_3286_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_3286_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_3286_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_3286_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_3286_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_3286_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_3286_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_3286_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_3286_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_3286_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_3286_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_3286_24(int v) {
    return (v * 25) + 72;
}
